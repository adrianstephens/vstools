//import { ProjectItemEntry, PackageReference, ProjectReference, Reference } from "./Items";

import * as vscode from 'vscode';
import * as path from "path";
import * as glob from "./glob";
import * as config from "./config";
import * as convert from "xml-js";
import {Project, ProjectItemEntry, Configuration} from "./Project";

type XmlElement = convert.Element | convert.ElementCompact;

const readOptions: convert.Options.XML2JSON = {
	compact: false
};

const writeOptions: convert.Options.JS2XML = {
	compact: false,
	spaces: 2
};

function parseToJson(content: string): Promise<XmlElement> {
	const result = convert.xml2js(content, readOptions);
	if (result.declaration)
		delete result.declaration;
	return Promise.resolve(result);
}

/*
function parseToXml(content: XmlElement): Promise<string> {
	writeOptions.spaces = config.getXmlSpaces();
	let result = convert.js2xml(content, writeOptions);
	if (config.getXmlClosingTagSpace()) {
		const re = /([A-Za-z0-9_\"]+)\/\>/g;
		result = result.replace(re,"$1 />");
	}

	// By default the XML module will output files with LF.
	// We will convert that to CRLF if enabled.
	if(config.getLineEndings() === "crlf") {
		result = eol.crlf(result);
	}

	// #118 look inside quoted strings and replace '&' by '&amp;'
	const m = result.match(/"([^"]*)"/g);
	if (m) {
		m.forEach(match => {
			if (match.indexOf('&') >= 0) {
				const rr = match.replace(/&/g, '&amp;');
				result = result.replace(match, rr);
			}
		});
	}

	return Promise.resolve(result);
}
*/
function ensureElements(element: XmlElement): XmlElement {
	if (!element.elements || !Array.isArray(element.elements))
		element.elements = [];
	return element;
}
function getProjectElement(document: XmlElement): XmlElement | undefined {
	if (document && document.elements) {
		if (document.elements.length === 1)
			return ensureElements(document.elements[0]);

		for (const i of document.elements) {
			if (i.type !== 'comment')
				return ensureElements(i);
		}
	}
}

function firstOf(value: string, find: string): number {
	let index = value.length;
	for (const c of find) {
		const i = value.indexOf(c);
		if (i >= 0)
			index = Math.min(i);
	}
	return index;
}

function getRecursiveDir(filepath: string, searchPath: string): string {
	let result = path.dirname(filepath).substring(searchPath.length + 1);
	if (result) {
		if (result.startsWith(path.sep))
			result = result.substring(1);
		if (!result.endsWith(path.sep))
			result += path.sep;
	}
	return result;
}

export class Folder  {
	public folders: Folder[] = [];
	public entries: ProjectItemEntry[] = [];
	constructor(public readonly name: string) {}
	public add(item : ProjectItemEntry) {
		this.entries.push(item);
	}
}

export class FolderTree {
	public root : Folder = new Folder("");

	public addDirectory(relativePath : string) : Folder {
		const parts = relativePath.split(path.sep);
		let folder  = this.root;
		for (const part of parts) {
			if (part !== "." && part != "..") {
				let next = folder.folders.find(e => e.name == part);
				if (!next) {
					next = new Folder(part);
					folder.folders.push(next);
				}
				folder = next;
			}
		}
		return folder;
	}
	public add(item : ProjectItemEntry) {
		this.addDirectory(path.dirname(item.relativePath)).add(item);
	}
}

class Items {
	public entries: ProjectItemEntry[] = [];
	
	constructor(public readonly name: string) {
	}

	public async includeEntries(basePath: string, value: string, link: string, exclude?: string, dependentUpon?: string) {
		for (const pattern of value.split(';')) {
			const index = Math.min(firstOf(pattern, '*?[{'), pattern.lastIndexOf(path.sep));
			const searchPath = path.join(basePath, pattern.substring(0, index + 1));
			
			const result = await glob.globFileSearch(searchPath, pattern.substring(index + 1), exclude?.split(';'));
			for (const filepath of result) {
				const recursiveDir = getRecursiveDir(filepath, basePath);
				const relativePath = path.relative(basePath, filepath);//getRelativePath(filepath, recursiveDir, link);
				const isLink = !filepath.startsWith(basePath);

				let isDirectory: boolean;
				try {
					const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filepath));
					isDirectory = stat.type === vscode.FileType.Directory;
				} catch (e) {
					isDirectory = path.extname(filepath) === "";
				}

				if (!this.entries.find(e => e.relativePath === relativePath)) {
					this.entries.push({
						name: path.basename(relativePath),
						fullPath: filepath,
						relativePath: relativePath,
						isDirectory: isDirectory,
						isLink: isLink,
						dependentUpon: dependentUpon
					});
				}
			}
		}
	}
	public removeEntries(basePath: string, value: string) {
		function isPathRemoved(basePath: string, sourcePath: string): boolean {
			return glob.globTest(value.split(";").map(s => path.join(basePath, s)), sourcePath);
		}
		this.entries = this.entries.filter(e => !isPathRemoved(basePath, e.fullPath));
	}

	public updateEntries(basePath: string, value: string, link: string) {
		for (const entry of this.entries) {
			if (glob.globTest(value.split(";").map(s => path.join(basePath, s)), entry.fullPath)) {
				const recursiveDir = getRecursiveDir(path.sep + entry.relativePath, "");
				const relativePath = getRelativePath(entry.fullPath, recursiveDir, link);
				entry.name = path.basename(relativePath);
				entry.relativePath = relativePath;
			}
		}
	}
}

class Reference {
	constructor(public readonly name: string, public readonly version: string | undefined) {
	}
}
class ProjectReference {
	constructor(public readonly name: string, public readonly relativePath: string) {
	}
}
class PackageReference {
	constructor(public readonly name: string, public readonly version: string) {
	}
}

const ignoreItems = [
	"AssemblyMetadata", "BaseApplicationManifest", "CodeAnalysisImport", "COMReference", "COMFileReference", "Import", "InternalsVisibleTo", "NativeReference", "TrimmerRootAssembly", "Using", "Protobuf",
	"ProjectConfiguration"
 ];

function getLink(xml: XmlElement) {
	let link = xml.attributes.Link || xml.elements?.find((e: XmlElement) => e.name === "Link")?.elements[0].text;
	link = link ? toOSPath(link) : undefined;

	let linkBase = xml.attributes.LinkBase || xml.elements?.find((e: XmlElement) => e.name === "LinkBase")?.elements[0].text;
	linkBase = linkBase ? toOSPath(linkBase) : undefined;

	return (link || "%(LinkBase)" + path.sep + "%(RecursiveDir)%(Filename)%(Extension)").replace("%(LinkBase)", linkBase || "");
}

function toOSPath(input: string): string {
	if (!input)
		return input;
	return input
		.replace(/\\/g, path.sep)
		.trim()
		.replace(new RegExp(`${path.sep}$`), '');
}

function isGlobExpression(input: string): boolean {
	return input.indexOf('*') >= 0
		|| input.indexOf('?') >= 0
		|| input.indexOf('[') >= 0
		|| input.indexOf('{') >= 0;
}

function replacePropertiesInPath(path: string, properties: Record<string, string>, osPath?: boolean): string {
	if (!path || !properties)
		return path;

	Object.entries(properties).forEach(([key, value]) =>
		path = path.replaceAll(`$(${key})`, value)
	);

	return osPath !== false ? toOSPath(path) : path;
}

function cleanPathDownAtStart(filepath: string): string {
	const folderDown = ".." + path.sep;
	while (filepath.startsWith(folderDown))
		filepath = filepath.substring(folderDown.length);
	return filepath;
}
function getRelativePath(filepath: string, recursiveDir: string, link: string): string {
	const extension = path.extname(filepath);
	const filename = path.basename(filepath, extension);
	const result = link
						.replace("%(Extension)", extension)
						.replace("%(Filename)", filename)
						.replace("%(RecursiveDir)", recursiveDir);

	return result.startsWith(path.sep) ? result.substring(1) : result;
}

export class MsBuildProject extends Project {
	private sdk: string | undefined;
	private toolsVersion: string | undefined;

	private references: Reference[] = [];
	private projectReferences: ProjectReference[] = [];
	private packagesReferences: PackageReference[] = [];
	public foldertree: FolderTree = new FolderTree;
	public projectItems: Items[] = [];
	public ready : Promise<void> | undefined;

	constructor(parent:any, type:string, name:string, path:string, guid:string) {
		super(parent, type, name, path, guid);
		this.ready = this.refresh();
	}

	public async refresh(): Promise<void> {
		this.references = [];
		this.packagesReferences = [];
		this.projectReferences = [];
		this.foldertree = new FolderTree;

		return vscode.workspace.fs.readFile(vscode.Uri.file(this.path))
		.then(bytes => new TextDecoder().decode(bytes))
		.then(content =>  parseToJson(content))
		.then(async document => {
			const project = getProjectElement(document);
			if (!project)
				return;
	
			if ((this.sdk = project.attributes && project.attributes.Sdk)) {
				const exclude = [...config.getNetCoreIgnore(), this.path].join(";");
				//this.includeEntries("Compile", "**/*", exclude);
				//const allFolders = new Include("Compile", "**/*", undefined, undefined, exclude);
				//result.push(allFolders);
			}
	
			this.toolsVersion = project.attributes && project.attributes.ToolsVersion;
	
			const properties: Record<string, string> = {};
			const projectBasePath = path.dirname(this.path);
			const packagesPath = path.join(projectBasePath, 'packages.config');

			for (const element of project.elements) {
				if (element.name === 'PropertyGroup') {
					ensureElements(element);
					element.elements.forEach((e: XmlElement) => {
						let value = e.elements?.find((el: XmlElement) => el.type == "text")?.text ?? "";
						Object.entries(properties).forEach(([k, v]) => value = value.replaceAll(`$(${k})`, v));
						properties[e.name] = value;
					});

				} else if (element.name === 'ItemGroup') {
					ensureElements(element);
					for (const item of element.elements) {
						if (item.name === "Reference" && item.attributes && item.attributes.Include) {
							const include = replacePropertiesInPath(item.attributes.Include, properties, false);
							const parts = include.split(',');
							const version = parts.find(p => p.trim().startsWith('Version='));
							this.references.push(new Reference(parts[0], version ? version.split('=')[1] : undefined));

						} else if (item.name === "ProjectReference" && item.attributes && item.attributes.Include) {
							const relativePath = replacePropertiesInPath(item.attributes.Include, properties);
							const name = path.basename(relativePath, path.extname(relativePath));
							const guid = item.elements?.find((e: XmlElement) => e.name === "Project")?.elements[0].text;

							const proj = this.parent.projects[guid.toUpperCase()];
							if (proj)
								this.addDependency(proj);

							this.projectReferences.push(new ProjectReference(name, relativePath));

						} else if (item.name === "PackageReference" && item.attributes && item.attributes.Include) {
							try {
								vscode.workspace.fs.readFile(vscode.Uri.file(packagesPath))
								.then(bytes => new TextDecoder().decode(bytes))
								.then(content => {
									const packageRegEx = /<package\s+id="(.*)"\s+version="(.*)"\s+targetFramework="(.*)"/g;
									let m: RegExpExecArray | null;
									while ((m = packageRegEx.exec(content)) !== null)
										this.packagesReferences.push(new PackageReference(m[1].trim(), m[2].trim()));
								});
							} catch (e) {
								// Ignore
							}

						} else if (item.name === "Folder" && item.attributes && item.attributes.Include) {
							//this.getFolderEntries(replacePropertiesInPath(item.attributes.Include, properties));
							const folderpath = path.resolve(projectBasePath, replacePropertiesInPath(item.attributes.Include, properties));
							this.foldertree.addDirectory(folderpath);

						} else if (ignoreItems.indexOf(item.name) === -1 && item.attributes) {
							let items = this.projectItems.find(i => i.name == item.name);
							if (!items) {
								items = new Items(item.name);
								this.projectItems.push(items);
							}

							if (item.attributes.Include) {
								const include = replacePropertiesInPath(item.attributes.Include, properties);
								const excludes = item.attributes.Exclude ? replacePropertiesInPath(item.attributes.Exclude, properties) : undefined;
								const dependentUpon = toOSPath(item.elements?.find((e: XmlElement) => e.name === "DependentUpon")?.elements[0].text);
								await items.includeEntries(projectBasePath, include, getLink(item), excludes, dependentUpon);
							}
						
							if (item.attributes.Remove)
								items.removeEntries(projectBasePath, replacePropertiesInPath(item.attributes.Remove, properties));
						
							if (item.attributes.Update)
								items.updateEntries(projectBasePath, replacePropertiesInPath(item.attributes.Update, properties), getLink(item));
						}
					}
				}
			}
	
			for (const i of this.projectItems) {
				for (const entry of i.entries)
					this.foldertree.add(entry);
			}
		});
	}
}
