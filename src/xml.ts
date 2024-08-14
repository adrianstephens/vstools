export class Comment {
	constructor(public comment: string) {}
}
export class CDATA {
	constructor(public cdata: string) {}
}
export class DocType {
	constructor(public doctype: string) {}
}

export type Node		= Element | string | Comment | CDATA | DocType;
export type Attributes	= Record<string, string>;
export type Entities	= Record<string, string>;

export function isElement(arg: Node | undefined): arg is Element 	{ return typeof(arg)=='object' && 'name' in arg; }
export function isText(arg: Node | undefined): arg is string 		{ return typeof(arg)=='string'; }
export function isComment(arg: Node): arg is Comment 				{ return typeof(arg)=='object' && 'comment' in arg; }
export function isDocType(arg: Node): arg is DocType 				{ return typeof(arg)=='object' && 'doctype' in arg; }
export function isCDATA(arg: Node): arg is CDATA 					{ return typeof(arg)=='object' && 'cdata' in arg; }

const criticalEntities: Record<string, string> = {
	amp: 	'&',	//must be first!
	gt:		'>',
	lt:		'<',
};

export type OutputOptions = {
	newline?:	string,
	indent?:	string,
	afteratt?:	string,
	entities?:	Entities,
}

export class Element {
	next?:		Element;
	parent?:	Element;
	_elements?:	Record<string, Element>;
	options?:	OutputOptions;

	constructor(public name: string, public attributes: Attributes = {}, public children: Node[] = []) {}

	public get elements() {
		if (!this._elements) {
			this._elements = {};
			for (const i of this.children) {
				if (isElement(i)) {
					i.next = this.elements[i.name];
					this._elements[i.name] = i;
				}
			}
		}
		return this._elements;
	}

	public firstElement(): Element | undefined 	{ return this.children.find(i => isElement(i)); }
	public firstText() 							{ return this.children.find(i => isText(i)); }
	public allText(): string[]					{ return this.children.filter(i => isText(i)); }
	public allElements(): Element[] 			{ return this.children.filter(i => isElement(i)); }
	public toString() 							{ return toString(this, this.options); }
	public setOptions(options: OutputOptions)	{ this.options = options; return this; }

	public add(e: Node) {
		this.children.push(e);
		if (isElement(e))
			e.parent = this;
	}
	public setText(text: string) {
		for (const i in this.children) {
			if (isText(this.children[i]))
				this.children[i] = text;
			return;
		}
		this.add(text);
	}

	[Symbol.iterator]() {
		const initial = this;
		let i : Element|undefined = initial;
		return {
			next: () => {
				if (i) {
					const i0 = i;
					i = i?.next;
					return {done: false, value: i0};
				}
				return {done: true, value: initial};
			}
		};
	}
}

//-----------------------------------------------------------------------------
//	Entities
//-----------------------------------------------------------------------------

function replace(text: string, re: RegExp, process: (match: RegExpExecArray)=>string) {
	let m;
	let i = 0;
	let result = '';

	while ((m = re.exec(text))) {
		result += text.substring(i, m.index) + process(m);
		i = re.lastIndex;
	}
	return result + text.substring(i);
}

export function removeEntities(text: string, entities: Entities) {
	return replace(
		text,
		/&(#(\d+)|#x([0-9a-fA-F]+)|[^;]+);/g,
		m =>  m[2] ? String.fromCharCode(parseInt(m[2], 10))
			: m[3] ? String.fromCharCode(parseInt(m[3], 16))
			: entities[m[1]] ?? m[0]
	);
}

export class EntityCreator {
	reverse:	Record<string, string>;
	re:			RegExp;

	constructor(entities: Entities) {
		this.reverse	= Object.entries(entities).reduce((a, [k, v]) => (a[v] = k, a), {} as Record<string, string>);
		this.re			= new RegExp(`([${Object.values(entities).join('')}])|([\u0000-\u0008\u000b-\u001f\ud800-\udfff\ufffe-\uffff])`, 'g');
	}
	replace(text: string) {
		return replace(text, this.re, m => m[1] ? `&${this.reverse[m[1]]};` : `&#x${m[2].charCodeAt(0).toString(16)};`);
	}
}

//-----------------------------------------------------------------------------
//	SAX
//-----------------------------------------------------------------------------


const nameStart		= /[:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/;
const nameBody		= /[:_.A-Za-z0-9\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u037D\u037F-\u1FFF\u200C-\u200D\u203F-\u2040\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u00B7-]/;
const nameRe		= new RegExp(`${nameStart.source}${nameBody.source}*`);
const attrRe		= new RegExp(`\\s*(${nameRe.source})(:?\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(${nameRe.source})))?`, 'ys');

export function parseAttributes(text: string, entities: Entities) : Attributes {
	const attributes: Attributes = {};
	let 	m : RegExpExecArray | null;
	while ((m = attrRe.exec(text))) {
		const value = m[3] ?? m[4] ?? m[5];
		attributes[m[1]] = value && removeEntities(value, entities);
	}
	return attributes;
}

export interface SaxOptions {
	onerror?:			(e: Error) => boolean | void;
	ontext?:			(t: string) => void;
	ondoctype?:			(doctype: string) => void;
	onprocessing?:		(name: string, body: string) => void;
	onopentag?:			(tagName: string, attributes: Attributes) => void;
	onclosetag?:		(tagName: string) => void;
	oncomment?:			(comment: string) => void;
	oncdata?:			(cdata: string) => void;
	entities?:			Entities;
}

export function sax(xml: string, options: SaxOptions) {
	let		lastIndex = 0;
	let 	m : RegExpExecArray | null = null;

	function error(message: string) {
		if (options.onerror) {
			const count = xml.substring(0, lastIndex).match(/\n/g)?.length ?? 0;
			return options.onerror(new Error(`${message} at line ${count + 1}`));
		}
		return false;
	}

	function match(re: RegExp, from = lastIndex) {
		re.lastIndex = from;
		m = re.exec(xml);
		if (!m)
			return false;
		lastIndex = re.lastIndex;
		return true;
	}

	const entities = {...criticalEntities, quot: '"', ...options?.entities};

	const	re = /(.*?)<(.)/sy;
	while (match(re)) {
		if (!m)
			return;	// can't happen!

		if (m[1])
			options.ontext?.(removeEntities(m[1], entities));

		switch (m[2]) {
			case '/':
				if (match(new RegExp(`(${nameRe.source})\\s*>`, 'ys')))
					options.onclosetag?.(m[1]);
				else if (!error('bad closing tag'))
					return;
				break;

			case '?':
				if (match(new RegExp(`(${nameRe.source})(.*)\\?>`, 'ys')))
					options.onprocessing?.(m[1], m[2]);
				else if (!error('bad processing instruction'))
					return;
				break;

			case '!':
				if (xml.substring(lastIndex, lastIndex + 2) === '--') {
					if (match(/(.*?)-->/ys, lastIndex + 2))
						options.oncomment?.(m[1]);
					else if (!error('unterminated comment'))
						return;

				} else if (xml.substring(lastIndex, lastIndex + 7) === '[CDATA[') {
					if (match(/(.*?)]]>/ys, lastIndex + 7))
						options.oncdata?.(m[1]);
					else if (!error('unterminated cdata'))
						return;

				} else if (xml.substring(lastIndex, lastIndex + 7) === 'DOCTYPE') {
					if (match(/([^[]*(\[.*]\s+))>/ys, lastIndex + 7))
						options.ondoctype?.(m[1]);
					else if (!error('bad DOCTYPE'))
						return;

				} else if (!error('bad directive')) {
					return;
				}
				break;

			default:
				if (match(new RegExp(`${nameRe.source}`, 'y'), lastIndex - 1)) {
					const name = m[0];

					const attributes: Attributes = {};
					while (match(attrRe)) {
						if (m[5] && !error("missing quotes"))
							return;
						const value = m[3] ?? m[4] ?? m[5];
						if (value === undefined && !error("missing value"))
							return;
						attributes[m[1]] = removeEntities(value, entities);
					}

					if (match(/\s*([/])?>/y)) {
						options.onopentag?.(name, attributes);
						if (m[1])
							options.onclosetag?.(name);
						continue;
					}
				}
				if (!error('bad opening tag'))
					return;
		}
	}
	if (lastIndex < xml.length)
		options.ontext?.(xml.substring(lastIndex));
}

//-----------------------------------------------------------------------------
//	parse
//-----------------------------------------------------------------------------

export interface InputOptions {
	entities?:	Entities,
	allowUnclosed?:	RegExp,

	allowAttributeWithoutValue?:	boolean,
	allowNonQuotedAttribute?:		boolean,
}

//export function newparse(xml: string) {
export function parse(xml: string, options?: InputOptions) {
	let current	= new Element('');
	sax(xml, {
		onopentag: (name: string, attributes: Attributes) => {
			const element = new Element(name, attributes);
			current.add(element);
			current = element;
		},
		onclosetag: (name: string) => {
			while (name !== current.name) {
				if (!options?.allowUnclosed?.test(current.name))
					return 'end tag mismatch';
				current = current.parent!;
			}
			current = current.parent!;
		},

		ontext: (text: string) => {
			if ((text = text.trim()))
				current.add(text);
		},
		oncomment: (comment: string) => {
			current.add(new Comment(comment));
		},
		oncdata: (cdata: string) => {
			current.add(new CDATA(cdata));
		},
		ondoctype: (doctype: string) => {
			current.add(new DocType(doctype.replace(/^ /, '')));
		},
		onprocessing: (name: string, body: string) => {
			if (name.toLowerCase() === 'xml') {
				current.name = '?' + name;
				current.attributes = parseAttributes(body, {...criticalEntities, quot: '"', ...options?.entities});
			}
		},
		onerror: (e: Error) => {
			console.log(e.message);
			return (e.message == "missing quotes" && options?.allowNonQuotedAttribute)
				|| (e.message == "missing value" && options?.allowAttributeWithoutValue);
		},
		entities: options?.entities,
	});
	return current;
}

//-----------------------------------------------------------------------------
//	toString
//-----------------------------------------------------------------------------

export function writeAttributes(attributes: Attributes, entity_creator: EntityCreator = new EntityCreator({...criticalEntities, quot: '"'}), after = ' ') {
	const a = Object.entries(attributes).map(([k,v]) => `${k}="${entity_creator.replace(v)}"`).join(' ');
	return a ? ' ' + a + after : '';
}

export function toString(element: Element, options?: OutputOptions) {
	const indent	= options?.indent ?? '  ';
	const afteratt	= options?.afteratt ?? '';

	const entities		= new EntityCreator({...criticalEntities, ...options?.entities});
	const entities_att	= new EntityCreator({...criticalEntities, quot: '"', ...options?.entities});

	function writeElement(element : Element, newline : string) : string {
		const xml = `<${element.name}${writeAttributes(element.attributes, entities_att, afteratt)}`;

		if (element.name.startsWith('?'))
			return xml + '?>' + newline + writeElement(element.children[0] as Element, newline);

		if (element.children.length || element.attributes['xml:space'] === 'preserve') {
			const nextline 	= newline + indent;
			let result = element.children.reduce((xml, i) =>
					isElement(i)	? xml + nextline + writeElement(i, nextline)
				:	isText(i)		? xml + entities.replace(i)
				:	isComment(i)	? xml + nextline + `<!--${i.comment}-->`
				:	isDocType(i)	? xml + nextline + `<!DOCTYPE ${i.doctype}>`
				:	isCDATA(i)		? xml + `<![CDATA[${i.cdata.replace(']]>', ']]]]><![CDATA[>')}]]>`
				:	xml
			,  xml + '>');
			if (element.children.length > 1 || !isText(element.children[0]))
				result += newline;
			return result + `</${element.name}>`;
		} else {
			return xml + '/>';
		}
	}

	if (!element.name)
		element = element.children[0] as Element;
	return writeElement(element, options?.newline ?? '\n');
}

/*

//-----------------------------------------------------------------------------
//	verification
//-----------------------------------------------------------------------------

//import *  as oldsax from 'sax';

export function oldparse(xml: string) {
	const parser = oldsax.parser(true, {});
	let current	= new Element('');

	parser.onopentag = (tag: oldsax.Tag | oldsax.QualifiedTag) => {
		tag = tag as oldsax.Tag;
		const element = new Element(tag.name, tag.attributes);
		element.next = current;

		current.children.push(element);
		current = element;
	};
    parser.onclosetag = (tagName: string) => {
		for (let i = current.children.length; i--;) {
			const e = current.children[i];
			if (isElement(e)) {
				e.next = current.elements[e.name];
				current.elements[e.name] = e;
			}
		}
		const parent = current.next;
		delete current.next;
		current = parent as Element;
	};

    parser.ontext = (text: string) => {
		if ((text = text.trim()))
			current.children.push(new TextEntry(text));
	};
    parser.oncomment = (comment: string) => {
		current.children.push(new Comment(comment));
	};
    parser.oncdata = (cdata: string) => {
		current.children.push(new CDATA(cdata));
	};
    parser.ondoctype = (doctype: string) => {
		current.children.push(new DocType(doctype.replace(/^ /, '')));
	};
    parser.onprocessinginstruction = (node: { name: string; body: string }) => {
		if (node.name.toLowerCase() === 'xml') {
			current.name = '?' + node.name;
			current.attributes = parseAttributes(node.body, {...criticalEntities, quot: '"'});
		}
	};

	parser.onerror = (e: Error) => {};

    parser.write(xml).close();
	return current;
}

function compare_xml(a: Element, b: Element) {
	if (a.name != b.name)
		return false;

	const ka = Object.keys(a.attributes);
	const kb = Object.keys(b.attributes);
	if (ka.length != kb.length)
		return false;

	for (const k of ka) {
		if (a.attributes[k] != b.attributes[k])
			return false;
	}

	const n = a.children.length;
	if (n != b.children.length)
		return false;
	for (let i = 0; i < n; i++) {
		const e = isElement(a.children[i]);
		if (e !== isElement(b.children[i]))
			return false;
		if (e && !compare_xml(a.children[i] as Element, b.children[i] as Element))
			return false;
	}
	return true;
}

export function parse(xml: string) {
	const rnew = newparse(xml);
	const rold = oldparse(xml);
	compare_xml(rnew, rold);
	return rnew;
}
*/

