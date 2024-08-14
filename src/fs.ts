import * as vscode from 'vscode';
import * as path from "path";
import { error } from 'console';

class Glob {
	private readonly regexp: RegExp;

	constructor(pattern: string) {
		this.regexp = toRegExp(pattern);
	}

	public match(input: string): RegExpMatchArray | null {
		return this.regexp.exec(input);
	}

	public test(input: string): boolean {
		return this.regexp.test(input);
	}
}

export function toOSPath(input: string | undefined): string {
	if (!input)
		return '';
	return input
		.replace(/\\/g, path.sep)
		.trim();
		//.replace(new RegExp(`${path.sep}$`), '');
}
export function isWild(pattern: string): boolean {
	return pattern.indexOf("*") >= 0
		|| pattern.indexOf("?") >= 0
		|| pattern.indexOf("[") >= 0
		|| pattern.indexOf("{") >= 0;
}

function toRegExp(pattern: string): RegExp {
	let re = "", range = false, block = false;
	for (let i = 0; i < pattern.length; i++) {
		const c = pattern[i];
		switch (c) {
			default:	re += c; break;
			case ".":
			case "/":
			case "\\":
			case "$":
			case "^":	re += "\\" + c; break;
			case "?":	re += "."; break;
			case "[":	re += "["; range = true; break;
			case "]":	re += "]"; range = false; break;
			case "!":	re += range ? "^" : "!"; break;
			case "{":	re += "("; block = true; break;
			case "}":	re += ")"; block = false; break;
			case ",":	re += block ? "|" : "\\,"; break;
			case "*":
				if (pattern[i + 1] === "*") {
					re += ".*";
					i++;
					if (pattern[i + 1] === "/" || pattern[i + 1] === "\\")
						i++;
				} else {
					re += "[^/]*";
				}
				break;
		}
	}
	return new RegExp(re);
}

export function match(pattern: string, input: string): RegExpMatchArray | null {
	return isWild(pattern)
		? toRegExp(pattern).exec(input)
		: input.match(pattern);
}

export function test(pattern: string | string[], input: string): boolean {
	if (typeof pattern === "string")
		pattern = [pattern];
	
	for (const p of pattern) {
		if (isWild(p)) {
			if (toRegExp(p).exec(input))
				return true;
		} else if (input.endsWith(p)) {
			return true;
		}
	}

   return false;
}

export function readDirectory(dir: string) : Thenable<[string, vscode.FileType][]> {
	return vscode.workspace.fs.stat(vscode.Uri.file(dir)).then(stat => {
		if (stat.type == vscode.FileType.Directory) {
			return vscode.workspace.fs.readDirectory(vscode.Uri.file(dir)).then(
				items => items,
				error => {
					console.log(`readDirectory failed with ${error}`);
					return [];
				}
			);
		} else {
			console.log(`readDirectory ${dir} is not a directory`);
			return Promise.resolve([]);
		}
	}, error => {
		console.log(`readDirectory failed with ${error}`);
		return Promise.resolve([]);
	});
}

export async function search(basePath: string, pattern: string, exclude?:string | string[], type = vscode.FileType.Unknown): Promise<string[]> {
    if (!isWild(pattern))
        return [path.join(basePath, pattern)];

    return readDirectory(basePath).then(async items => {
		const result: string[] = [];
		for (const i of items) {
            const filename = path.join(basePath, i[0]);
			if (type && i[1] !== type)
				continue;

            if (exclude && test(exclude, filename))
                continue;

            if (test(pattern, filename))
                result.push(filename);

            if (i[1] == vscode.FileType.Directory)
                result.push(...await search(filename, pattern, exclude));
        }
		return result;
    });
}

export async function getFiles(pattern: string): Promise<string[]> {
	if (!pattern)
		return [];
    if (!isWild(pattern))
        return [pattern];

	const dir	= path.dirname(pattern);
	const re	= toRegExp(path.basename(pattern));
    return readDirectory(dir).then(
		items => items.filter(i => i[1] == vscode.FileType.File && re.test(i[0])).map(i => path.join(dir, i[0]))
    );
}


export function exists(value: string): Thenable<boolean> {
	return vscode.workspace.fs.stat(vscode.Uri.file(value)).then(() => true, () => false);
}

export function getStat(value: string): Thenable<vscode.FileStat | undefined> {
	return vscode.workspace.fs.stat(vscode.Uri.file(value)).then(stat => stat, () => undefined);
}

export function isDirectory(value: string): Thenable<boolean> {
	return vscode.workspace.fs.stat(vscode.Uri.file(value)).then(stat => stat.type == vscode.FileType.Directory, () => path.extname(value) === "");
}

function removeBOM(bytes: Uint8Array): Uint8Array {
	if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
		// UTF-8 BOM detected, remove it
		return bytes.slice(3);
	} else if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
		// UTF-16 BE BOM detected, remove it
		return bytes.slice(2);
	} else if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
		// UTF-16 LE BOM detected, remove it
		return bytes.slice(2);
	}

	// No BOM detected, return the original bytes
	return bytes;
}

function BOMtoEncoding(bytes: Uint8Array): string {
	return	bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF ?'utf-8'
		:	bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF ? 'utf-16be'
		:	bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE ? 'utf-16le'
		: 	'utf-8';
}

export function loadTextFile(file: string): Thenable<string> {
	return vscode.workspace.fs.readFile(vscode.Uri.file(file)).then(
		bytes => new TextDecoder(BOMtoEncoding(bytes)).decode(bytes),
		error => console.log(`Failed to load ${file} : ${error}`)
	);
}
export function writeFile(file: string, bytes: Uint8Array) {
	return vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(file)))
	.then(() => vscode.workspace.fs.writeFile(vscode.Uri.file(file), bytes))
	.then(
		() => true,
		error => (console.log(`Failed to save ${file} : ${error}`), false)
	);
}

export function deleteFile(file: string) {
	return vscode.workspace.fs.delete(vscode.Uri.file(file)).then(
		() => true,
		error => (console.log(`Failed to delete ${file} : ${error}`), false)
	);
}
export function createDirectory(path: string) {
	return vscode.workspace.fs.createDirectory(vscode.Uri.file(path)).then(
		() => true,
		error => (console.log(`Failed to create ${path} : ${error}`), false)
	);
}

export async function createCopyName(filepath: string): Promise<string> {
	const parsed = path.parse(filepath);
    let counter = 1;
    while (await exists(filepath)) {
        filepath = path.join(parsed.dir, parsed.name + ' copy' + (counter > 1 ? ' ' + counter : '') + parsed.ext);
        counter++;
    }
    return filepath;
}

export function copyFile(sourcepath: string, targetpath: string): Thenable<string> {
	const dest = createCopyName(path.join(targetpath, path.basename(sourcepath)));
	return vscode.workspace.fs.readFile(vscode.Uri.file(sourcepath))
	.then(async bytes => {
		const destpath = await dest;
		vscode.workspace.fs.writeFile(vscode.Uri.file(destpath), bytes);
		return destpath;
	});
}

export async function copyDirectory(sourcepath: string, targetpath: string): Promise<string[]> {
	const dest = createCopyName(path.join(targetpath, path.basename(sourcepath)));
	const dir = await readDirectory(sourcepath);

	let result: string[] = [];
	for (const i of dir) {
		const sourcepath2 = path.join(sourcepath, i[0]);
		if (i[1] === vscode.FileType.Directory)
			result = [...result, ...await copyDirectory(sourcepath2, await dest)];
		else
			result.push(await copyFile(sourcepath2, await dest));
	}
	return result;
}

