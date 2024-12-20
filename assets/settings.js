/*global window, document, console, acquireVsCodeApi, ResizeObserver*/

const state	 	= vscode.getState() ?? {};
let content_width = 0;

const vscroll 	= new ScrollBar(document.body, document.documentElement, false);
const splitter	= new Splitter(document.querySelector('.splitter'), split => {
	state.split = split;
	vscode.setState(state);
});

function space_remaining(item) {
	return item.parentNode.getBoundingClientRect().right - item.getBoundingClientRect().left;
}

function autoResize(textarea) {
	textarea.style.height = '0';
	textarea.style.height = textarea.scrollHeight + 4 + 'px';
}

function debounce(callback, delay) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => callback(...args), delay);
    };
}

function debounceAccumulated(callback, delay) {
    let timeout;
    const pending = new Map();
    
    return entries => {
        entries.forEach(entry => pending.set(entry.target, entry));
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            const entries = Array.from(pending.values());
            pending.clear();
            callback(entries);
        }, delay);
    };
}

const resizeObserver = new ResizeObserver(entries => {
	for (const entry of entries) {
		if (entry.contentBoxSize) {
			entry.target.querySelectorAll('span').forEach(i => i.style.maxWidth = `${space_remaining(i) - 2}px`);
		}
	}
});

document.addEventListener('DOMContentLoaded', () => {
	vscode.postMessage({command: 'ready', state});
	document.body.style.display = '';
	if (state.top)
		document.scrollingElement.scrollTop = state.top;

	const content	= document.querySelector('.settings-content');
	const textareas	= content.querySelectorAll('textarea');
	content_width = content.clientWidth;

	const contentObserver = new ResizeObserver(debounce(() => {
		if (content.clientWidth != content_width) {
			textareas.forEach(textarea => autoResize(textarea));
			content_width = content.clientWidth;
		}
	}, 16));
	contentObserver.observe(content);

	if (state.split)
		splitter.set(state.split);
});


function parentWithClass(item, className) {
	while (item && !item.classList.contains(className))
		item = item.parentNode;
	return item;
}

function inputValue(input) {
	return input.type == 'checkbox' ? input.checked
		: input.type == 'textarea' ? input.value.replace('\n', ';')
		: input.tagName == 'SPAN' ? input.textContent
		: input.value;
}

function setInput(input, value, placeholder) {
	if (input.type == 'checkbox') {
		input.indeterminate = false;
		input.checked = value;

	} else if (input.tagName == 'SELECT') {
		input.value = value;
		if (placeholder)
			input.classList.add('inherit');
		else
			input.classList.remove('inherit');

	} else {
		if (input.type == 'textarea') {
			value = value.split(';').filter(i => !!i).join('\n');
			//input.rows = value.length;
			//value = value.join('\n');
		}
		if (placeholder) {
			input.placeholder = value;
			value = '';
		}
		input.value = value;
		if (input.type == 'textarea')
			autoResize(input);
	}
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
			id: input.attributes.name.value,
			value: inputValue(input)
		})
	));
}

function setupChecks(items, selector, command) {
	items.forEach(item => item.addEventListener('click', event => {
		const items = document.querySelectorAll(selector);
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
function setupChecks1(selector, command) {
	setupChecks(document.querySelectorAll(selector), selector, command);
}

setupButtons(document.querySelectorAll('button'), 'click');
setupChecks1('#configuration input[type="checkbox"]', 'configuration');
setupChecks1('#platform input[type="checkbox"]', 'platform');

//-------------------------------------
// navigation
//-------------------------------------

let activeItem 	= null;
const targets 	= [];
const tree		= new Tree(document.querySelector('#sidebar'), (item, open) => {
	setActive(item);
});


function setActive(item) {
	if (activeItem)
		activeItem.classList.remove('active');
	item.classList.add('active');
	activeItem = item;
}

tree.root.querySelectorAll('.caret').forEach(caret => {
	Array.from(caret.getElementsByTagName("li")).forEach(item => {
		const target = document.getElementById(item.getAttribute('data-target'));
		targets.push({item, target, caret});

		item.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			setActive(item);
			target.scrollIntoView({ behavior: 'smooth' });
		});
	});

});

targets.sort((a, b) => a.target.offsetTop - b.target.offsetTop);

window.addEventListener('scroll', ()=> {
	vscroll.update();
	state.top = document.scrollingElement.scrollTop;
	vscode.setState(state);
	for (let a = 0, b = targets.length; a !== b;) {
		const m = Math.floor((a + b) / 2);
		const i = targets[m];
		const rect = i.target.getBoundingClientRect();
		if (rect.top > 0) {
			b = m;
		} else if (rect.bottom < 0) {
			a = m + 1;
		} else {
			const prevcaret = parentWithClass(activeItem, 'caret');
			if (prevcaret)
				prevcaret.classList.remove("caret-down");
			setActive(i.item);
			i.caret.classList.add("caret-down");
			return;
		}
	}
});


//-------------------------------------
// settings
//-------------------------------------

document.querySelectorAll('label').forEach(item =>
	item.addEventListener('click', () => {
		const id = item.getAttribute('for');
		document.querySelectorAll('#'+id.replace(/\./g, '\\.')).forEach(i => i.parentNode.classList.remove('modified'));
		vscode.postMessage({
			command: "revert",
			id: id
		});

	})
);
document.querySelectorAll('.setting-item input').forEach(input => {
	if (input.type == 'checkbox') {
		input.addEventListener("change", event => {
			vscode.postMessage({
				command: 'change',
				id: input.id,
				value: input.checked
			});
		});
	} else {
		input.addEventListener("input", event => {
			vscode.postMessage({
				command: 'change',
				id: input.id,
				value: inputValue(input)
			});
		});
	}
});
document.querySelectorAll('.setting-item select').forEach(input => {
	input.addEventListener("change", event => {
		vscode.postMessage({
			command: 'change',
			id: input.id,
			value: inputValue(input)
		});
	});
});
document.querySelectorAll('.setting-item textarea').forEach(input => {
	input.addEventListener("change", event => {
		vscode.postMessage({
			command: 'change',
			id: input.id,
			value: inputValue(input)
		});
	});
});


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

window.addEventListener('message', event => {
	switch (event.data.command) {
		case 'set': {
			for (let i in event.data.values) {
				let	 value			= event.data.values[i];
				const isArray	 	= Array.isArray(value);
				const placeholder	= isArray && !value[1];

				const input = document.getElementById(i);
				if (input)
					setInput(input, isArray ? value[0] : value, placeholder);
				else
					log("didn't find" + i);
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

		case 'delete':
			document.querySelectorAll(event.data.selector).forEach(i => {
				for (let j = event.data.parent; j--; )
					i = i.parentNode;
				i.parentNode.removeChild(i);
			});
			break;

		case 'splice': {
			const item = document.getElementById(event.data.item);

			let dest = event.data.dest;
			if (dest < 0)
				dest = item.children.length + dest;

			for (let n = event.data.remove; n; --n)
				item.removeChild(item.children[dest]);

			if (event.data.values) {
				const entry = item.children[event.data.source ?? 0];
				template(entry, item, event.data.values);
/*
				const newnodes = event.data.values.map(i => {
					const child = entry.cloneNode(true);
					child.hidden = false;
					replace_in_element(child, /\$\((.*)\)/g, m => i[m[1]]);
					return child;
				});

				const dummy = document.createElement("div");
				dummy.append(...newnodes);
				setupChecks(dummy.querySelectorAll('input[type="checkbox"]'), `#${event.data.item} input[type="checkbox"]`, event.data.item);
				setupButtons(dummy.querySelectorAll('button'), 'click');
				setupEdits(dummy.querySelectorAll('span'), 'change');

				const before = item.children[dest];
				for (const i of newnodes)
					item.insertBefore(i, before);
*/
				resizeObserver.observe(item);
			}
			break;
		}
	}
});
