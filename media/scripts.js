/*global window, document, console, acquireVsCodeApi, ResizeObserver*/

const vscode = acquireVsCodeApi();

let activeItem = null;

function setActive(item) {
    if (activeItem)
        activeItem.classList.remove('active');
    item.classList.add('active');
    activeItem = item;
}

function inputValue(input) {
    return input.type == 'checkbox' ? input.checked
        : input.type == 'textarea' ? input.value.replace('\n', ';')
        : input.tagName == 'SPAN' ? input.textContent
        : input.value;
}

function setupButtons(items, command) {
    items.forEach(button => button.addEventListener('click', () =>
        vscode.postMessage({
            command: command,
            id: button.id
        })
    ));
}

function setupEdits(items, command) {
    items.forEach(input => input.addEventListener("input", event =>
        vscode.postMessage({
            command: command,
            item: input.attributes.name.value,
            value: inputValue(input)
        })
    ));
}

function setupChecks(items, command) {
    items.forEach(item => item.addEventListener('click', event => {
        if (!event.shiftKey) {
            for (const i of items)
                i.checked = false;
            item.checked = true;
        }
        
        vscode.postMessage({
            command: command,
            value: Array.from(items).filter(i => i.checked).map(i => i.name)
        });
    }));
}

setupChecks(document.querySelectorAll('#configuration input[type="checkbox"]'), 'configuration');
setupChecks(document.querySelectorAll('#platform input[type="checkbox"]'), 'platform');

document.querySelectorAll('.caret').forEach(caret => {
    caret.addEventListener('click', () => {
        caret.children[0].classList.toggle("nested");
        caret.classList.toggle("caret-down");
        setActive(caret.parentElement);
    });
    Array.from(caret.getElementsByTagName("li")).forEach(item => {
        item.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            setActive(item);
            document.getElementById(item.getAttribute('data-target')).scrollIntoView({ behavior: 'smooth' });
        });
    });

});

document.querySelectorAll('.setting-item input[type="checkbox"]').forEach(item =>
    item.indeterminate = true
);

document.querySelectorAll('label').forEach(item =>
    item.addEventListener('click', () => {
        const id = item.getAttribute('for');
        document.querySelectorAll('#'+id.replace(/\./g, '\\.')).forEach(i => i.parentNode.classList.remove('modified'));
        //item.parentNode.classList.remove('modified');
        vscode.postMessage({
            command: "revert",
            item: id
        });

    })
);


for (const form of document.forms) {
    for (const input of form) {
        if (input.type == 'checkbox') {
            input.addEventListener("change", event => {
                vscode.postMessage({
                    command: 'change',
                    form: form.id,
                    item: input.attributes.name,
                    value: input.checked
                });
            });
        } else {
            input.addEventListener("input", event => {
                vscode.postMessage({
                    command: 'change',
                    form: form.id,
                    item: input.name,
                    value: inputValue(input)
                });
            });
        }
    }

    form.addEventListener("submit", event => {
        event.preventDefault();
        const data = {};
        for (const i of form) {
            if (i.type != 'checkbox' || !i.indeterminate)
                data[i.name] = inputValue(i);
        }

        vscode.postMessage({
            command: 'save',
            form: form.id,
            values: data
        });
    });
}

/*
function init_list_entry(item, value) {
    item.getElementsByTagName('input')[0].value = value;
    item.getElementsByTagName("button")[0].addEventListener('click', event => {
        item.remove();
    });
}

//const multis = document.querySelectorAll('.multi');

multi:
const children = multi.getElementsByTagName('div');
let lastchild = children[children.length - 1];
event.data[i].split(';').forEach(entry => {
    if (entry) {
        const newchild = lastchild.cloneNode(true);
        multi.appendChild(newchild);
        init_list_entry(lastchild, entry);
        lastchild = newchild;
    }
});
*/

function replace(text, re, process) {
	let m;
	let i = 0;
	let result = '';

	while ((m = re.exec(text))) {
		result += text.substring(i, m.index) + process(m);
		i = re.lastIndex;
	}
	return result + text.substring(i);
}

function replace_in_element(e, re, process) {
    if (e.id)
        e.id = replace(e.id, re, process);
    if (e.attributes.name)
        e.attributes.name.value = replace(e.attributes.name.value, re, process);
    const childNodes = e.childNodes;
    for (let i = 0; i < childNodes.length; i++) {
        const node = childNodes[i];
        if (node.nodeType === window.Node.TEXT_NODE) {
            node.textContent = replace(node.textContent, re, process);
        } else if (node.nodeType === window.Node.ELEMENT_NODE) {
            replace_in_element(node, re, process);
        }
    }
}

function space_remaining(item) {
    return item.parentNode.getBoundingClientRect().right - item.getBoundingClientRect().left;
}

const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
        if (entry.contentBoxSize) {
            entry.target.querySelectorAll('span').forEach(i => i.style.maxWidth = `${space_remaining(i) - 2}px`);
        }
    }
});


window.addEventListener('message', event => {
    switch (event.data.command) {
        case 'set': {
            for (let i in event.data.values) {
                let value = event.data.values[i];
                const placeholder = i.startsWith('?');
                const e = document.getElementById(placeholder ? i.substring(1) : i);
                if (e) {
                    if (e.type == 'checkbox') {
                        e.indeterminate = false;
                        e.checked = value;
                    } else if (e.tagName == 'SELECT') {
                        e.value = value;
                        if (placeholder)
                            e.classList.add('inherit');
                        else
                            e.classList.remove('inherit');

                    } else {
                        if (e.type == 'textarea') {
                            value = value.split(';');
                            e.rows = value.length;
                            value = value.join('\n');
                        }
                        if (placeholder) {
                            e.placeholder = value;
                            value = '';
                        }
                        e.value = value;
                    }
                } else {
                    console.log("didn't find" + i);
                }
            }
            break;
        }
        case 'clear_form': {
            const form = document.getElementById(event.data.form);
            if (form) {
                for (const e of form) {
                    if (e.type == 'checkbox') {
                        e.indeterminate = true;
                        e.checked = false;
                    } else if (e.tagName == 'SELECT') {
                        e.classList.add('inherit');
                        e.value = '';
                    } else if (e.type == 'textarea') {
                        e.rows = 1;
                        e.value = '';
                    } else {
                        e.value = '';
                    }
                }
            }
            break;
        }
        case 'add_class':
            document.querySelectorAll(event.data.selector).forEach(i => {
                for (let j = event.data.parent; j--; )
                    i = i.parentNode;
                if (event.data.enable)
                    i.classList.add(event.data.class);
                else
                    i.classList.remove(event.data.class);
            });
            break;

        case 'set_attribute':
            document.querySelectorAll(event.data.selector).forEach(i => {
                for (let j = event.data.parent; j--; )
                    i = i.parentNode;
                i.setAttribute(event.data.attribute, event.data.value);
            });
            break;

        case 'set_checklist': {
            const item = document.getElementById(event.data.item);
            const entry = item.children[1];
            const next  = entry.nextElementSibling;
            for (const i of event.data.values) {
                const child = entry.cloneNode(true);
                child.hidden = false;
                replace_in_element(child, /\$\((.*)\)/g, m => i[m[1]]);
                if (next)
                    item.insertBefore(child, next);
                else
                    item.appendChild(child);
            }

            resizeObserver.observe(item);
            setupChecks(item.querySelectorAll('input[type="checkbox"]'), event.data.item);
            setupButtons(item.querySelectorAll('button'), 'click');
            setupEdits(item.querySelectorAll('span'), 'change');
            break;
        }
    }
});
