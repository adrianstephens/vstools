import * as vscode from 'vscode';
import * as path from "path";
import * as xml from "./xml";
import * as fs from 'fs';
import {Uri} from 'vscode';
import {Solution} from "./Solution";
import {Project} from "./Project";
import {SolutionExplorerProvider} from "./SolutionView";
import {array_remove, parseColor, colorString, rgb2hsv, hsv2rgb, replace} from './utils';
import { alignCursors } from './align';

let the_solution: Solution;

export async function xml_load(uri : vscode.Uri) : Promise<xml.Element | undefined> {
	console.log(`Loading ${uri.fsPath}`);
	return vscode.workspace.fs.readFile(uri)
		.then(bytes => new TextDecoder().decode(bytes))
		.then(
			content	=> xml.parse(content),
			error	=> console.log(`Failed to load ${uri.fsPath} : ${error}`)
		);
}

export async function xml_save(uri : vscode.Uri, element: xml.Element) : Promise<void> {
/*
	vscode.workspace.fs.writeFile(uri, Buffer.from(xml.js2xml(element), "utf-8"))
		.then(
			()		=> {},
			error	=> console.log(`Failed to save ${uri.fsPath} : ${error}`)
		);
*/
	fs.writeFile(uri.fsPath, Buffer.from(element.toString(), "utf-8"), error => {
		if (error)
			console.log(`Failed to save ${uri.fsPath} : ${error}`);
	});
}

export class XMLCache {
	public static cache : Record<string, Promise<xml.Element | void>> = {};

	public static async get(fullpath: string) : Promise<xml.Element | void> {
		if (!this.cache[fullpath])
			this.cache[fullpath] = xml_load(vscode.Uri.file(fullpath));
		return this.cache[fullpath];
	}
	public static remove(fullpath: string) {
		delete this.cache[fullpath];
	}
}

export class Extension {
	static context: vscode.ExtensionContext;
	static currentProject : Project | undefined;

    private static fileWatchers: Record<string, [watcher: vscode.FileSystemWatcher, funcs: ((path: string)=>void)[]]> = {};
    private static singleWatchers: Record<string, ((path: string)=>void)[]> = {};

	public static registerCommand(command: string, callback: (...args: any[]) => any, thisArg?: any) {
		const disposable = vscode.commands.registerCommand(command, callback);
		Extension.context.subscriptions.push(disposable);
	}

	public static absoluteUri(relativePath: string) {
		return Uri.joinPath(Extension.context.extensionUri, relativePath);
	}

	public static onChange(fullpath: string, func: (path: string)=>void) {
		const dir = path.dirname(fullpath);
		if (!Extension.fileWatchers[dir]) {
			const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dir, "*.*"));
			watcher.onDidChange((uri: Uri) => {
				const fullpath = uri.fsPath;
				Extension.fileWatchers[path.dirname(fullpath)][1].forEach(func => func(fullpath));
				Extension.singleWatchers[fullpath]?.forEach(func => func(fullpath));
			});
			Extension.fileWatchers[dir] = [watcher, []];
		}
		if (fullpath.indexOf('*') == -1) {
			if (!Extension.singleWatchers[fullpath])
				Extension.singleWatchers[fullpath] = [];
			Extension.singleWatchers[fullpath].push(func);
		} else {
			Extension.fileWatchers[dir][1].push(func);
		}
	}

	public static removeOnChange(fullpath: string, func: (path: string)=>void) {
		const dir = path.dirname(fullpath);
		if (Extension.fileWatchers[dir]) {
			if (fullpath.indexOf('*') == -1) {
				if (Extension.singleWatchers[fullpath])
					array_remove(Extension.singleWatchers[fullpath], func);
			} else {
				array_remove(Extension.fileWatchers[dir][1], func);
			}
		}
	}

	public static setCurrentProject(project : Project | undefined) {
		this.currentProject = project;
	}
	public static getCurrentProject(solution: Solution, name?: string) : Project | undefined {
		return name ? solution.projectByName(name) : this.currentProject;
	}

	public static getIcon(name : string) {
		return {
			light: Extension.absoluteUri(`media/${name}.svg`),
			dark: Extension.absoluteUri(`media/dark/${name}.svg`)
		};
	}
}

async function makeDarkIcons(from:Uri, to:Uri) {
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
		return replace(style, /(fill|stroke)\s*:\s*([^;]+)/g, (m : RegExpExecArray) => m[1] + ':'+ process_colour(m[2]));
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

	vscode.workspace.fs.createDirectory(to)
	.then(() => vscode.workspace.fs.readDirectory(from))
	.then(async dir => {
		for (const file of dir) {
			if (file[1] === vscode.FileType.File && path.extname(file[0]) == '.svg') {
				await xml_load(Uri.joinPath(from, file[0])).then(doc => {
					if (doc?.firstElement()?.name === "svg") {
						process(doc);
						xml_save(Uri.joinPath(to, file[0]), doc);
					}
				});
			}
		}
	});
}

function VSDir(filepath : string | undefined) {
	return path.dirname(filepath || "") + path.sep;
}

function Settings(solution: Solution, project?: string) {
	return Extension.getCurrentProject(solution, project)?.configuration[solution.activeConfiguration.fullName];
}


export function activate(context: vscode.ExtensionContext) {
	console.log("vstools activated");
	Extension.context = context;

	Extension.registerCommand('vstools.align', alignCursors);

	const dark_dir = Extension.absoluteUri('media/dark');
//	makeDarkIcons(Extension.absoluteUri('media'), dark_dir);
	vscode.workspace.fs.stat(dark_dir).then(undefined, () => makeDarkIcons(Extension.absoluteUri('media'), dark_dir));

	vscode.workspace.findFiles('*.sln').then(slns => {
		if (slns.length === 1) {
			Solution.read(slns[0].fsPath).then(solution => {
				if (solution) {
					the_solution = solution;
					vscode.commands.executeCommand('setContext', 'vstools.loaded', true);
					new SolutionExplorerProvider(solution);

					Extension.registerCommand('vstools.solutionPath', 	() => solution.fullpath);
					Extension.registerCommand('vstools.solutionDir', 	() => VSDir(solution.fullpath));
					Extension.registerCommand('vstools.startupProject',	() => solution.startupProject?.name);
					Extension.registerCommand('vstools.projectDir', 	(project?: string) => VSDir(Extension.getCurrentProject(solution, project)?.fullpath));
					Extension.registerCommand('vstools.projectName', 	() => Extension.currentProject?.name);
					Extension.registerCommand('vstools.configuration', 	() => solution.activeConfiguration?.Configuration);
					Extension.registerCommand('vstools.platform', 		() => solution.activeConfiguration?.Platform);
					Extension.registerCommand('vstools.projectConfiguration', (project?: string) => Settings(solution, project)?.[0].fullName);
					Extension.registerCommand('vstools.projectSetting', (setting: string) => {
						const project = solution.startupProject;
						if (project)
							return project.getSetting(project.configuration[solution.activeConfiguration.fullName]?.[0].properties || {}, setting);
					});
				}
			});
		}
	});
}

export async function deactivate() {
	return the_solution.dispose();
}
