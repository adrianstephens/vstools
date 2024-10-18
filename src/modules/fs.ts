import * as vscode from 'vscode';
import * as path from "path";
import {Uri} from 'vscode';
import * as utils from './utils';

export class Glob {
	private readonly regexp: RegExp;

	constructor(pattern: string | string[]) {
		if (typeof pattern === 'string' && pattern.includes(';'))
			pattern = pattern.split(';');
		const re = Array.isArray(pattern)
			? '(' + pattern.map(s => toRegExp(s)).join('|') + ')'
			: toRegExp(pattern);
		this.regexp = new RegExp(re + '$');
	}
	public test(input: string): boolean {
		return this.regexp?.test(input) ?? false;
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
function toRegExp(pattern: string) {
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
					re += "[^/\\\\]*";
				}
				break;
		}
	}
	return re;
}

export type Entry = [string, vscode.FileType];

export function readDirectory(dir: string) : Thenable<Entry[]> {
	return vscode.workspace.fs.stat(Uri.file(dir)).then(stat => {
		if (stat.type == vscode.FileType.Directory) {
			return vscode.workspace.fs.readDirectory(Uri.file(dir)).then(
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

export function directories(entries: Entry[]) {
	return entries.filter(e => e[1] == vscode.FileType.Directory).map(e => e[0]);
}
export function files(entries: Entry[], glob?: string|Glob) {
	if (glob) {
		const include = typeof glob === 'string' ? new Glob(glob) : glob;
		return entries.filter(e => e[1] == vscode.FileType.File && include.test(e[0])).map(e => e[0]);
	} else {
		return entries.filter(e => e[1] == vscode.FileType.File).map(e => e[0]);
	}
}

export async function search(pattern: string, _exclude?:string | string[], want = vscode.FileType.Unknown): Promise<string[]> {
	const m = /[*?[{}]/.exec(pattern);
	if (!m)
		return [pattern];

	const sep 		= pattern.lastIndexOf('\\', m.index);
	const basePath	= pattern.substring(0, sep);
	const include	= new Glob(pattern.substring(sep + 1));
	const exclude	= _exclude ? new Glob(_exclude) : undefined;
	const keep		= want || vscode.FileType.File;

	const recurse = async (basePath: string) => {
		const items = await readDirectory(basePath);
		const result: string[] = [];
		for (const i of items) {
			if (want && i[1] !== want)
				continue;

			const filename = path.join(basePath, i[0]);
			if (exclude && exclude.test(filename))
				continue;

			if (i[1] === keep && include.test(filename))
				result.push(filename);

			if (i[1] == vscode.FileType.Directory)
				result.push(...await recurse(filename));

		}
		return result;
	};
	return recurse(basePath);
}

export async function mapDirs<T>(root: string, glob: string|Glob, onFile:(filename:string)=>T, combine:(...results:T[])=>T) : Promise<T> {
	const glob2 = typeof glob === 'string' ? new Glob(glob) : glob;
	return readDirectory(root).then(async dir => combine(
		...await Promise.all(files(dir, glob).map(i => onFile(path.join(root, i)))),
		...await Promise.all(directories(dir).map(async i => mapDirs<T>(path.join(root, i), glob2, onFile, combine)))
	
	));
}

export function stat_reject(value: string) {
	return vscode.workspace.fs.stat(Uri.file(value));
}

export function exists(value: string): Thenable<boolean> {
	return vscode.workspace.fs.stat(Uri.file(value)).then(
		() => true,
		() => false
	);
}

export function getStat(value: string): Thenable<vscode.FileStat | undefined> {
	return vscode.workspace.fs.stat(Uri.file(value)).then(stat => stat, () => undefined);
}

export function isDirectory(value: string): Thenable<boolean> {
	return vscode.workspace.fs.stat(Uri.file(value)).then(stat => stat.type == vscode.FileType.Directory, () => path.extname(value) === "");
}

export async function loadFile(file: string): Promise<Uint8Array> {
	return vscode.workspace.fs.readFile(Uri.file(file)).then(
		bytes	=> bytes,
		error	=> console.log(`Failed to load ${file} : ${error}`)
	);
}

export async function loadTextFile(file: string): Promise<string> {
	return vscode.workspace.fs.readFile(Uri.file(file)).then(
		bytes	=> utils.decodeText(bytes, utils.getTextEncoding(bytes)),
		error	=> console.log(`Failed to load ${file} : ${error}`)
	);
}
export async function loadTextFileEncoding(file: string): Promise<[string, utils.TextEncoding]> {
	return vscode.workspace.fs.readFile(Uri.file(file)).then(
		bytes	=> {
			const encoding = utils.getTextEncoding(bytes);
			return [utils.decodeText(bytes, encoding), encoding];
		},
		error	=> console.log(`Failed to load ${file} : ${error}`)
	);
}

export function writeFile(file: string, bytes: Uint8Array) {
	return vscode.workspace.fs.writeFile(Uri.file(file), bytes).then(
		()		=> true,
		error	=> (console.log(`Failed to save ${file} : ${error}`), false)
	);
}

export function writeTextFile(file: string, data: string, encoding:utils.TextEncoding = 'utf8') {
	return writeFile(file, utils.encodeText(data, encoding));
}

export function deleteFile(file: string) {
	return vscode.workspace.fs.delete(Uri.file(file)).then(
		()		=> true,
		error	=> (console.log(`Failed to delete ${file} : ${error}`), false)
	);
}
export function createDirectory(path: string) {
	return vscode.workspace.fs.createDirectory(Uri.file(path)).then(
		()		=> true,
		error	=> (console.log(`Failed to create ${path} : ${error}`), false)
	);
}

export async function createNewName(filepath: string): Promise<string> {
	const parsed = path.parse(filepath);
	let counter = 0;
	const m = /\d+$/.exec(parsed.name);
	if (m) {
		counter = parseInt(m[0]);
		parsed.name = parsed.name.substring(0, m.index);
	}
	while (await exists(filepath))
		filepath = path.join(parsed.dir, `${parsed.name}${++counter}${parsed.ext}`);
	return filepath;
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

export async function copyFile(sourcepath: string, destpath: string): Promise<void> {
	return vscode.workspace.fs.readFile(Uri.file(sourcepath)).then(async bytes => vscode.workspace.fs.writeFile(Uri.file(destpath), bytes));
}

export async function copyFileToDir(sourcepath: string, destdir: string): Promise<string> {
	const dest = createCopyName(path.join(destdir, path.basename(sourcepath)));
	return vscode.workspace.fs.readFile(Uri.file(sourcepath))
	.then(async bytes => {
		const destpath = await dest;
		vscode.workspace.fs.writeFile(Uri.file(destpath), bytes);
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
			result.push(await copyFileToDir(sourcepath2, await dest));
	}
	return result;
}

//-----------------------------------------------------------------------------
//	watchers
//-----------------------------------------------------------------------------

export const Change = {
	changed:	0,
	created:	1,
	deleted:	2,
	renamed:	3,
} as const;

type Callback		= ((path: string, mode: number)=>void);
type GlobCallback	= [Glob, Callback];

const recWatchers:		Record<string, vscode.FileSystemWatcher> = {};
const dirWatchers:		Record<string, vscode.FileSystemWatcher> = {};
const fileModTimes:		Record<number, string> = {};
const recCallbacks:		Record<string, Callback[]> = {};
const dirCallbacks:		Record<string, GlobCallback[]> = {};
const fileCallbacks:	Record<string, Callback[]> = {};

let wait_create: Thenable<void> = Promise.resolve();


function runCallbacks(callbacks: Callback[]|undefined, fullpath: string, mode:number) {
	if (callbacks)
		callbacks.forEach(func => func(fullpath, mode));
}

function runGlobCallbacks(callbacks: GlobCallback[]|undefined, fullpath: string, mode:number) {
	if (callbacks) {
		const base = path.basename(fullpath);
		callbacks.forEach(func => func[0].test(base) && func[1](fullpath, mode));
	}
}

async function dirCallback(uri: Uri, mode:number) {
	const fullpath = uri.fsPath;
	console.log(`Mod: ${mode} on ${fullpath}`);
	switch (mode) {
		case Change.changed:
			stat_reject(fullpath).then(
				stat => fileModTimes[stat.mtime] = fullpath,
				error=> {}
			);
			runCallbacks(fileCallbacks[fullpath], fullpath, mode);
			break;

		case Change.created:
			wait_create = wait_create.then(() => stat_reject(fullpath).then(
				stat => {
					const renamed = fileModTimes[stat.mtime];
					if (renamed) {
						console.log(`Rename: ${renamed} to ${fullpath}`);
						fileModTimes[stat.mtime] = fullpath;
						fileCallbacks[fullpath] = fileCallbacks[renamed];
						delete fileCallbacks[renamed];
						runCallbacks(fileCallbacks[fullpath], fullpath, 3);
					}
				},
				error=> {}
			));
			break;

		case Change.deleted:
			wait_create.then(() => runCallbacks(fileCallbacks[fullpath], fullpath, mode));
			break;
	}
	runGlobCallbacks(dirCallbacks[path.dirname(fullpath)], fullpath, mode);
}

function recCallback(uri: Uri, mode:number) {
	const fullpath = uri.fsPath;
	fileCallbacks[fullpath]?.forEach(func => func(fullpath, mode));
	runGlobCallbacks(dirCallbacks[path.dirname(fullpath)], fullpath, mode);
	for (const i in recCallbacks) {
		if (fullpath.startsWith(i))
			runCallbacks(recCallbacks[i], fullpath, mode);
	}
}
/*
const renameDisposable = vscode.workspace.onDidRenameFiles((event) => {
	for (const file of event.files) {
		console.log(`File renamed:`);
		console.log(`  Old path: ${file.oldUri.fsPath}`);
		console.log(`  New path: ${file.newUri.fsPath}`);

		// You can add your custom logic here to handle the rename
	}
});
*/
export function onChange(fullpath: string, func: (path: string, mode: number)=>void) {
	let		dir 	= path.dirname(fullpath);
	const	file	= fullpath.indexOf('*') === -1;
	const 	rec		= dir.indexOf('*');
	if (rec !== -1)
		dir = dir.substring(0, rec - 1);

	let		watcher	= rec === -1 ? dirWatchers[dir] : recWatchers[dir];

	if (!watcher) {
		if (!Object.keys(recWatchers).some(i => fullpath.startsWith(i)))  {
			if (rec === -1) {
				watcher	= vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(Uri.file(dir), "*.*"));
				watcher.onDidChange((uri: Uri) => dirCallback(uri, Change.changed));
				watcher.onDidCreate((uri: Uri) => dirCallback(uri, Change.created));
				watcher.onDidDelete((uri: Uri) => dirCallback(uri, Change.deleted));
				dirWatchers[dir]	= watcher;

			} else {
				for (const i in dirWatchers) {
					if (i.startsWith(dir)) {
						dirWatchers[i].dispose();
						delete dirWatchers[i];
					}
				}
				watcher 	= vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(Uri.file(dir), "**/*.*"));
				watcher.onDidChange((uri: Uri) => recCallback(uri, Change.changed));
				watcher.onDidCreate((uri: Uri) => recCallback(uri, Change.created));
				watcher.onDidDelete((uri: Uri) => recCallback(uri, Change.deleted));
				recWatchers[dir] = watcher;
			}
		}
	}

	if (file) {
		stat_reject(fullpath).then(
			stat => fileModTimes[stat.mtime] = fullpath,
			error=> {}
		);
	}

	if (file) {
		(fileCallbacks[fullpath] ??= []).push(func);
	} else if (rec == -1) {
		(dirCallbacks[dir] ??= []).push([new Glob(path.basename(fullpath)), func]);
	} else {
		(recCallbacks[dir] ??= []).push(func);
	}
}

export function removeOnChange(fullpath: string, func: (path: string)=>void) {
	const dir = path.dirname(fullpath);
	if (fileCallbacks[dir]) {
		if (fullpath.indexOf('*') == -1) {
			//file
			const callbacks = fileCallbacks[fullpath];
			if (callbacks) {
				utils.array_remove(callbacks, func);
				if (callbacks.length === 0)
					delete fileCallbacks[fullpath];
			}
		} else if (dir.indexOf('*') == -1) {
			//dir
			const callbacks = dirCallbacks[dir];
			if (callbacks) {
				const i = callbacks.findIndex(i => i[1] === func);
				if (i !== -1) {
					callbacks.splice(i, 1);
					if (callbacks.length === 0) {
						delete dirCallbacks[dir];
						const watcher = dirWatchers[dir];
						if (watcher) {
							watcher.dispose();
							delete dirWatchers[dir];
						}
					}
				}
			}
		} else {
			//rec
			const callbacks = recCallbacks[dir];
			if (callbacks) {
				utils.array_remove(callbacks, func);
				if (callbacks.length === 0) {
					delete recCallbacks[dir];
					const watcher = recWatchers[dir];
					if (watcher) {
						watcher.dispose();
						delete recWatchers[dir];
					}
				}
			}
		}
	}
}
