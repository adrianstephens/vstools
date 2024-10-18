import * as fs from "fs";
import * as path from "path";
import * as xml from "../src/modules/xml";
import * as utils from '../src/modules/utils';

//-----------------------------------------------------------------------------
//	colours
//-----------------------------------------------------------------------------

export function parseColor(input: string) {
    if (input.startsWith("#")) {
        const v = parseInt(input.substring(1), 16);
        return input.length == 4
            ? utils.splitBinary(v, [4, 4, 4]).map(x => x / 15)
            : utils.splitBinary(v, [8, 8, 8]).map(x => x / 255);
    }
	return input.split("(")[1].split(")")[0].split(",").map(x => +x / 255);
}

export function colorString(rgb: number[]) {
    return '#' + rgb.reduce((p, c) => p * 256 + Math.round(c * 255), 1).toString(16).substring(1);
}

export function rgb2hsv(r: number, g: number, b: number) {
	let h = 0;
	let s = 0;

	const v 	= Math.max(r, g, b);
	const diff	= v - Math.min(r, g, b);
	
	function diffc(c:number) {
		return (v - c) / 6 / diff + 0.5;
	}

	if (diff) {
		s = diff / v;
		const rdif = diffc(r);
		const gdif = diffc(g);
		const bdif = diffc(b);

		h 	= r === v ?  bdif - gdif
			: g === v ? (1 / 3) + rdif - bdif
			: (2 / 3) + gdif - rdif;

		if (h < 0)
			h += 1;
		else if (h > 1)
			h -= 1;
	}

	return [h, s, v];
}

export function hsv2rgb(h: number, s: number, v: number) {
	h *= 6;

	const f = h - Math.floor(h);
	const p = v * (1 - s);
	const q = v * (1 - (s * f));
	const t = v * (1 - (s * (1 - f)));

	switch (Math.floor(h)) {
		default:	return [v, t, p];
		case 1:	return [q, v, p];
		case 2:	return [p, v, t];
		case 3:	return [p, q, v];
		case 4:	return [t, p, v];
		case 5:	return [v, p, q];
	}
}


//-----------------------------------------------------------------------------
//	files
//-----------------------------------------------------------------------------

async function stat(file: string) : Promise<fs.Stats> {
	return new Promise((resolve, reject) => {
		fs.stat(file, (err, stats) => {
			if (err)
				reject(err);
			else
				resolve(stats);
		});
	});
}


async function readFile(file: string) : Promise<Buffer> {
	return new Promise((resolve, reject) => {
		fs.readFile(file, (err, data) => {
			if (err)
				reject(err);
			else
				resolve(data);
		});
	});
}

async function writeFile(file: string, data: Buffer) : Promise<void> {
	return new Promise((resolve, reject) => {
		fs.writeFile(file, data, err => {
			if (err)
				reject(err);
			else
				resolve();
		});
	});
}

async function createDirectory(dir: string) : Promise<void> {
	return new Promise((resolve, reject) => {
		fs.mkdir(dir, err => {
			if (err)
				reject(err);
			else
				resolve();
		});
	});
}

async function readDirectory(dir: string) : Promise<string[]> {
	return new Promise((resolve, reject) => {
		fs.readdir(dir, (err, files) => {
			if (err)
				reject(err);
			else
				resolve(files);
		});
	});
}

export async function xml_load(file : string) : Promise<xml.Element | void> {
	console.log(`Loading ${file}`);
	return readFile(file)
		.then(bytes => new TextDecoder().decode(bytes))
		.then(
			content	=> xml.parse(content),
			error	=> console.log(`Failed to load ${file} : ${error}`)
		);
}

export async function xml_save(file: string, element: xml.Element) : Promise<void> {
	writeFile(file, Buffer.from(element.toString(), "utf-8"))
		.then(
			()		=> {},
			error	=> console.log(`Failed to save ${file} : ${error}`)
		);
}

async function makeDarkIcons(from:string, to:string) {
	console.log(`Processing ${from} to ${to}`);

	function process_colour(colour: string) : string {
		if (colour.startsWith("#")) {
			const	rgb = parseColor(colour);
			const	hsv = rgb2hsv(rgb[0], rgb[1], rgb[2]);
			if (hsv[1] < 0.5)
				return colorString(hsv2rgb(hsv[0], hsv[1], 1 - hsv[2]));
		}
		return colour;
	}
	function process_style(style: string) {
		return utils.replace(style, /(fill|stroke)\s*:\s*([^;]+)/g, (m : RegExpExecArray) => m[1] + ':'+ process_colour(m[2]));
	}
	function process(element: xml.Element) {
		if (element.attributes) {
			if (element.attributes.fill)
				element.attributes.fill = process_colour(element.attributes.fill.toString());
			if (element.attributes.stroke)
				element.attributes.stroke = process_colour(element.attributes.stroke.toString());
			if (element.attributes.style)
				element.attributes.style = process_style(element.attributes.style.toString());
		}
		for (const i of element.children) {
			if (xml.isElement(i)) {
				if (i.name === "style" && xml.isText(i.children[0]))
					i.children[0] = process_style(i.children[0]);
				process(i as xml.Element);
			}
		}
	}

	await createDirectory(to).catch(()=>undefined);
	readDirectory(from)
	.then(async dir => {
		for (const file of dir) {
			if (path.extname(file) == '.svg') {
				await xml_load(path.join(from, file)).then(doc => {
					if (doc?.firstElement()?.name === "svg") {
						console.log(`Processing ${file}`);
						process(doc);
						xml_save(path.join(to, file), doc);
					}
				});
			}
		}
	});
}
console.log(`hello`);

const dark_dir = 'assets/dark';
makeDarkIcons('assets', dark_dir);
//stat(dark_dir).then(undefined, () => makeDarkIcons('assets', dark_dir));
