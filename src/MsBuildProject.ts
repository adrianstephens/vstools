import * as vscode from 'vscode';
import * as path from "path";
import * as fs from "./fs";
import * as xml from "./xml";
import * as expression from "./expression";
import {Project, ProjectItemEntry, Folder, FolderTree, Properties, Configuration} from "./Project";
import {Extension, XMLCache, xml_load, xml_save} from './extension';
import {array_remove, firstOf} from './utils';



//-----------------------------------------------------------------------------
//	Properties
//-----------------------------------------------------------------------------

export class Result {
	constructor(public value: string, public loc?: xml.Element, public extra?: any) {}
	public source() : string|undefined { return this.loc?.firstText(); }
}

export type Settings	= Record<string, any>;
export type Source 		= Record<string, Result>;
export type Sources 	= Record<string, Source>;

type Definition = {
	condition: 	string;
	data: 		xml.Element[];
	isProject: 	boolean;
};

export class PropertyContext {
	public globals	= new Set<string>;
	
	constructor(public properties: Properties = {}) {}

	public substitute(value: string, leave_undefined = false): Promise<string> {
		return expression.substitute(value, /\$\((\w+|\[[\w.]+\])(\)|\.\w+\(|::\w+\()/g, this.properties, leave_undefined);
	}

	public substitute_path(path: string, osPath: boolean = true): Promise<string> {
		return this.substitute(path, true).then(path => osPath ? fs.toOSPath(path) : path);
	}

	public get_fullpath(origpath: string): Promise<string> {
		return this.substitute_path(origpath).then(subspath =>
			subspath.indexOf('$') === -1 ? path.resolve(this.properties.MSBUILDTHISFILEDIRECTORY, subspath) : ''
		);
	}

	public checkConditional(condition?: string) : Promise<boolean> {
		return !condition ? Promise.resolve(true) : this.substitute(condition).then(condition => expression.Evaluate(condition));
	}

	public async parse(element : xml.Element, substitute: boolean, mods?: Record<string, xml.Element>) {
		for (const e of element.children) {
			if (!(e as any).disabled && xml.isElement(e) && await this.checkConditional(e.attributes.Condition)) {
				const name = e.name.toUpperCase();
				if (!this.globals.has(name)) {
					this.properties[name] = await this.substitute(e.firstText() || '', !substitute);
					if (mods)
						mods[name] = e;
				}
			}
		}
	}

	public async add(props: Properties, substitute: boolean) {
		for (const i in props) {
			const name = i.toUpperCase();
			if (!this.globals.has(name))
				this.properties[name] = await this.substitute(props[i], !substitute);
		}
	}
	public add_direct(props: Properties) {
		for (const i in props)
			this.properties[i.toUpperCase()] = props[i];
	}

	public setPath(fullPath: string) {
		const parsed 	= path.parse(fullPath);
		this.properties.MSBUILDTHISFILEFULLPATH		= fullPath;
		this.properties.MSBUILDTHISFILEDIRECTORY	= parsed.dir + path.sep;
		this.properties.MSBUILDTHISFILENAME			= parsed.name;
		this.properties.MSBUILDTHISFILEEXTENSION	= parsed.ext;
		this.properties.MSBUILDTHISFILEFILE			= parsed.base;
	}

	public currentPath() {
		return this.properties.MSBUILDTHISFILEFULLPATH;
	}

	public makeLocal(locals: string[]) {
		locals.forEach(i => this.globals.delete(i.toUpperCase()));

	}
	public makeGlobal(globals: string[]) {
		globals.forEach(i => this.globals.add(i.toUpperCase()));
	}

}

type Imports = Record<string, string[]>;

async function evaluateImport(import_path: string, label: string, properties: PropertyContext, imports: Imports, final: boolean, modified?: Record<string, xml.Element>) {
	return properties.get_fullpath(import_path)
	.then(resolved => fs.getFiles(resolved))
	.then(async files => {
		for (const i of files) {
			if (imports.all.indexOf(i) !== -1)
				console.log(`Double import: ${i}`);

			const root = (await XMLCache.get(i))?.firstElement();
			if (root?.name == 'Project') {
				const prev = properties.currentPath();
				properties.setPath(i);
				console.log(`Evaluate ${i}`);
				await evaluatePropsAndImports(root.allElements(), properties, imports, final, modified);
				if (prev)
					properties.setPath(prev);
				if (!(label in imports))
					imports[label] = [];
				imports[label].push(i);
				imports.all.push(i);
			} else {
				console.log(`Invalid import: ${i} from ${import_path}`);
			}
		}
	});
}

async function evaluatePropsAndImports(raw_xml: xml.Element[], properties: PropertyContext, imports: Imports, final: boolean, modified?: Record<string, xml.Element>) {
	for (const element of raw_xml) {
		if (await properties.checkConditional(element.attributes.Condition)) {

			if (element.name === 'PropertyGroup') {
				await properties.parse(element, final, modified);

			} else if (element.name === "Import") {
				await evaluateImport(element.attributes.Project, '', properties, imports, final, modified);

			} else if (element.name === "ImportGroup") {
				const label = element.attributes.Label??'';
				for (const item of element.children) {
					if (xml.isElement(item) && item.name == "Import")
						await evaluateImport(item.attributes.Project, label, properties, imports, final, modified);
				}
			}
		}
	}
}

//-----------------------------------------------------------------------------
//	Items
//-----------------------------------------------------------------------------

//these items do not use file paths
const plainItems = new Set<string>([
	"BuildMacro", "AvailableItemName",
	"AssemblyMetadata", "BaseApplicationManifest", "CodeAnalysisImport",
	"COMReference", "COMFileReference",
	"InternalsVisibleTo", "NativeReference", "TrimmerRootAssembly", "Using", "Protobuf",
	"ProjectConfiguration", "ProjectCapability", 'ProjectTools',
]);

const nonNormalItems = new Set<string>([
	'PropertyPageSchema',
	'ProjectReference',
	'TargetPathWithTargetPlatformMoniker',
	'CoreCppClean', 'CoreClangTidy',
	'DebuggerPages', 'AppHostDebuggerPages','DesktopDebuggerPages',
	'GeneralDirsToMake',
	'ManifestResourceCompile'
]);

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

function getLink(element: xml.Element) {
	const link 		= fs.toOSPath(element.attributes.Link ?? element.elements.Link?.firstText());
	const linkBase 	= fs.toOSPath(element.attributes.LinkBase ?? element.elements.LinkBase?.firstText());
	return (link || "%(LinkBase)" + path.sep + "%(RecursiveDir)%(Filename)%(Extension)").replace("%(LinkBase)", linkBase || "");
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

async function evaluate_data1(item: xml.Element, settings: Settings, properties: PropertyContext, final: boolean) {
	if (item.firstElement()) {
		const result : Record<string, any> = {};
		for (const i of item.children) {
			if (xml.isElement(i))
				result[item.name] = await evaluate_data1(i, settings, properties, final);
		}
		return result;

	} else {
		const text = item.allText().join();
		if (final)
			return properties.substitute(text)
				.then(subs => expression.substitute(subs, /%\((\w+)(\))/g, settings));
	
		return text;
	}
}

async function evaluate_data(items: xml.Element[], settings: Settings, properties: PropertyContext, final: boolean, modified: Record<string, xml.Element>) {
	for (const i of items) {
		if (await properties.checkConditional(i.attributes.Condition)) {
			settings[i.name] = await evaluate_data1(i, settings, properties, final);
			modified[i.name] = i;
		}
	}
}

function metadata(entry: ProjectItemEntry) : xml.Element[]{
	if (Array.isArray(entry.data.xml))
		return entry.data.xml;
	console.log("bad metadata!");
	return [];
}

export function metadata_value(entry: ProjectItemEntry, name: string) {
	return metadata(entry).find(e => e.name === name)?.firstText() || '';
}

export function xml2data(xml: xml.Element[]) : Record<string, any> {
	return {xml:xml, ...Object.fromEntries(xml.filter(i => !i.firstElement()).map(i => [i.name, i.allText().join()]))};
}

export class Items {
	public	definitions: Definition[] = [];
	public 	entries: ProjectItemEntry[] = [];

	constructor(public name: string) {}

	public addDefinition(condition:string, data: xml.Element, isProject:boolean) {
		this.definitions.push({condition: condition, data: data.allElements(), isProject: isProject});
	}

	public getDefinition(condition: string, isProject:boolean) {
		for (const d of this.definitions) {
			if (d.condition === condition && d.isProject == isProject)
				return d;
		}
		const d = {condition: condition, data: [], isProject: isProject};
		this.definitions.push(d);
		return d;
	}

	public async evaluate(properties: PropertyContext, final: boolean, entry?: ProjectItemEntry) : Promise<[Settings, Record<string, xml.Element>]> {
		const modified :Record<string, xml.Element>[] = [{}, {}];
		const settings : Settings = {};
		for (const d of this.definitions) {
			if (await properties.checkConditional(d.condition))
				evaluate_data(d.data, settings, properties, final, modified[!entry && d.isProject ? 1 : 0]);
		}
		if (entry)
			evaluate_data(metadata(entry), settings, properties, final, modified[1]);
		return [settings, modified[1]];
	}

	public includePlain(name: string, data: Record<string, any>) {
		const item = this.entries.find(e => e.name === name);
		if (item) {
			item.data = {...item.data, ...data};
		} else {
			this.entries.push({
				name: name,
				data: data
			});
		}
	}

	public async includeFiles(basePath: string, value: string, link: string, exclude: string | undefined, data: xml.Element) {
		const excludes = exclude?.split(";");
		for (let pattern of value.split(';')) {
			if ((pattern = pattern.trim())) {
				const index 	= Math.min(firstOf(pattern, '*?[{'), pattern.lastIndexOf(path.sep));
				const search 	= path.resolve(basePath, pattern.substring(0, index + 1));
				for (const filepath of await fs.search(search, pattern.substring(index + 1), excludes)) {
					const item = this.entries.find(e => e.data.fullPath === filepath);
					if (item) {
						item.data.xml = [...item.data.xml, ...data.allElements()];
					} else {
						this.entries.push({
							name: path.basename(filepath),
							data: {
								fullPath: filepath,
								relativePath: path.relative(basePath, filepath),
								item: this,
								xml: data.allElements()
							}
						});
					}
					//if (!this.entries.find(e => e.data.fullPath === filepath))
					//	this.entries.push(await Project.makeEntry(basePath, filepath, element));
				}
			}
		}
	}

	public removeFiles(basePath: string, value: string) {
		const exclude = value.split(";").map(s => path.join(basePath, s));
		this.entries = this.entries.filter(e => !fs.test(exclude, e.data.fullPath));
	}

	public updateFiles(basePath: string, value: string, link: string) {
		const update = value.split(";").map(s => path.join(basePath, s));
		for (const entry of this.entries) {
			if (fs.test(update, entry.data.fullPath)) {
				const recursiveDir = getRecursiveDir(path.sep + entry.data.relativePath, "");
				const relativePath = getRelativePath(entry.data.fullPath, recursiveDir, link);
				entry.name = path.basename(relativePath);
				entry.data.relativePath = relativePath;
			}
		}
	}

	public getEntry(filepath : string) : ProjectItemEntry | undefined {
		for (const entry of this.entries)
			if (entry.data.fullPath === filepath)
				return entry;
	}

	public entries2Xml(plain:boolean, attributes: xml.Attributes) {
		return new xml.Element("ItemGroup", attributes, this.entries.map(e => {
			return new xml.Element(this.name, {Include: plain ? e.name : e.data.relativePath}, e.data.xml);
		}));
	}
}

async function readItems(elements: xml.Element[], properties: PropertyContext, allitems: Record<string, Items>, isProject: boolean): Promise<undefined> {
	//phase4 : items

	function getItems(name: string) {
		if (!(name in allitems)) {
			const lower = name.toLowerCase();
			const found = Object.keys(allitems).find(e => e.toLowerCase() === lower);
			if (found)
				name = found;
			else
				allitems[name] = new Items(name);
		}
		return allitems[name];
	}

	const basepath 	= properties.properties.MSBUILDTHISFILEDIRECTORY;

	for (const element of elements) {
		if (element.name === "ItemDefinitionGroup") {
			const condition = element.attributes.Condition ?? '';
			for (const item of element.children) {
				if (xml.isElement(item))
					getItems(item.name).addDefinition(condition, item, isProject);
			}

		} else if (element.name === 'ItemGroup') {//} && await properties.checkConditional(element.attributes.Condition)) {
			for (const item of element.children) {
				if (!xml.isElement(item))
					continue;
				
				const name	= item.name;
				const items = getItems(name);

				if (name === "Reference" && item.attributes.Include) {
					const include	= await properties.substitute_path(item.attributes.Include, false);
					const parts		= include.split(',');
					const version	= parts.find(p => p.trim().startsWith('Version='));
					items.includePlain(parts[0], {version: version ? version.split('=')[1] : undefined});

				} else if (name === "PackageReference" && item.attributes.Include) {
					try {
						vscode.workspace.fs.readFile(vscode.Uri.file(path.join(basepath, 'packages.config')))
						.then(bytes => new TextDecoder().decode(bytes))
						.then(content => {
							const packageRegEx = /<package\s+id="(.*)"\s+version="(.*)"\s+targetFramework="(.*)"/g;
							let m: RegExpExecArray | null;
							while ((m = packageRegEx.exec(content)) !== null)
								items.includePlain(m[1].trim(), {version: m[2].trim()});
						});
					} catch (e) {
						// Ignore
					}

				//} else if (name === "Folder" && item.attributes.Include) {
				//	foldertree.addDirectory(path.resolve(basepath, this.properties.substitute_path(item.attributes.Include)));

				} else if (plainItems.has(name) && item.attributes.Include) {
					const include = await properties.substitute(item.attributes.Include);
					items.includePlain(include, xml2data(item.allElements()));

				} else {
					if (item.attributes.Include) {
						const include = await properties.substitute_path(item.attributes.Include);
						const excludes = item.attributes.Exclude ? await properties.substitute_path(item.attributes.Exclude) : undefined;
						await items.includeFiles(basepath, include, getLink(item), excludes, item);
					}
				
					if (item.attributes.Remove)
						items.removeFiles(basepath, await properties.substitute_path(item.attributes.Remove));
				
					if (item.attributes.Update)
						items.updateFiles(basepath, await properties.substitute_path(item.attributes.Update), getLink(item));
				}
			}
		}
	}
}

//-----------------------------------------------------------------------------
//	Filters
//-----------------------------------------------------------------------------

async function loadFilterTree(fullPath : string, allfiles: Record<string, ProjectItemEntry>): Promise<FolderTree|undefined> {
	const basePath = path.dirname(fullPath);
	return xml_load(vscode.Uri.file(fullPath)).then(document => {
		const filtertree	= new FolderTree;
		const project		= document?.firstElement();

		if (project?.name == 'Project') {
			for (const element of project.children) {
				if (xml.isElement(element) && element.name === 'ItemGroup') {
					for (const item of element.children) {
						if (xml.isElement(item) && item.attributes.Include) {
							if (item.name === "Filter") {
								filtertree.addDirectory(item.attributes.Include);

							} else {
								const filename = path.resolve(basePath, item.attributes.Include);
								const entry = allfiles[filename];
								if (entry) {
									delete allfiles[filename];
									filtertree.addDirectory(item.elements.Filter?.firstText()).add(entry);
								}
							}
						}
					}
				}
			}
		}
		for (const i in allfiles)
			filtertree.root.add(allfiles[i]);

		return filtertree;
	});
}

async function saveFilterTree(tree: FolderTree, filename: string) {
	const get_group = (entry: ProjectItemEntry) => entry.data.item?.name ?? "None";
	const groups : Record<string, Set<ProjectItemEntry>> = {};

	const makeGroups = (folder: Folder, filtername:string, group: string, set: Set<ProjectItemEntry>) : xml.Element[] => {
		const acc: xml.Element[] = folder.entries.filter(i => set.has(i)).map(i => {
			if (!i.data.relativePath)
				i.data.relativePath = path.relative(filename, i.data.fullPath);
			return new xml.Element(get_group(i), {Include: i.data.relativePath}, filtername ? [
				new xml.Element('Filter', undefined, [filtername])
			] : []);
		});

		return folder.folders.reduce((acc, f) => {
			return [...acc, ...makeGroups(f, path.join(filtername, f.name), group, set)];
		}, acc);
	};

	const makeFilters = (folder: Folder, filtername:string) : xml.Element[] => {
		folder.entries.forEach(i => {
			const group = get_group(i);
			if (!groups[group])
				groups[group] = new Set<ProjectItemEntry>;
			groups[group].add(i);
		});
		const acc: xml.Element[] = [];
		if (filtername)
			acc.push(new xml.Element('Filter', {Include: filtername}));
		return folder.folders.reduce((acc, f) => [...acc, ...makeFilters(f, path.join(filtername, f.name))], acc);
	};

	const filters = new xml.Element('ItemGroup', undefined, makeFilters(tree.root, ''));
	const group_xml = Object.keys(groups).map(g => new xml.Element('ItemGroup', undefined, makeGroups(tree.root, '', g, groups[g])));

	const element = new xml.Element('?xml', {version: '1.0', encoding: "utf-8"}, [
		new xml.Element('Project', {ToolsVersion: '4.0', xmlns: "http://schemas.microsoft.com/developer/msbuild/2003"}, [
			filters,
			...group_xml
		])
	]);

	return xml_save(vscode.Uri.file(filename), element);
}

function CaseInsensitiveProxy(obj: Record<string, any>) {
	return new Proxy(obj, {
		get: (target, name) => {
			const upper = String(name).toUpperCase();
			return target[upper];
		}
	});
}

//-----------------------------------------------------------------------------
//	Rules
//-----------------------------------------------------------------------------

export type SchemaEntry = {
	raw: xml.Element,
	source: string,
	user: boolean,
};
export class SchemaFile {
	attributes: xml.Attributes;
	categories: Record<string, string> = {};
	entries: Record<string, SchemaEntry> = {};

	constructor(schema: xml.Element) {
		this.attributes		= schema.attributes;
		//this.name		= schema.attributes.Name;
		//this.display	= schema.attributes.DisplayName;
		//this.override	= schema.attributes.OverrideMode === 'Replace';

		let default_source	= '';
		let default_persist	= '';
	
		for (const item of schema.children) {
			if (!xml.isElement(item))
				continue;
	
			if (item.name === "Rule.DataSource") {
				const element = item.firstElement();
				default_source	= element?.attributes.ItemType || '';
				default_persist	= element?.attributes.Persistence || '';

			} else if (item.name === "Rule.Categories") {
				Array.from(item.elements.Category).filter(cat => cat.attributes.Subtype !== 'Search').forEach(cat => {
					this.categories[cat.attributes.Name?.toString() || ''] = cat.attributes.DisplayName ?? cat.elements['Category.DisplayName'].firstText();
				});

			} else if (item.attributes.Visible?.toString()?.toLowerCase() != "false") {
				const datasource = item.elements[item.name + '.DataSource']?.firstElement();
				const source	= datasource?.attributes.ItemType || default_source;
				const persist	= datasource?.attributes.Persistence || default_persist;
				this.entries[item.attributes.Name] = {
					raw: item,
					source: source,
					user: persist === 'UserFile'
				};
				//this.categories[item.attributes.Category ?? "General"].entries.push({raw: item, source: source, user: persist === 'UserFile'});
			}
		}
	}

	static async read(fullPath : string) : Promise<SchemaFile|undefined> {
		return XMLCache.get(fullPath).then(doc => {
			let element = doc?.firstElement();
			if (element?.name !== "Rule") {
				element = element?.firstElement();
				if (element?.name !== "Rule")
					return;
			}
			return new SchemaFile(element);
		});
	}

	public combine(b: SchemaFile) {
		this.attributes = {...b.attributes, ...this.attributes};

		if (b.attributes.OverrideMode === 'Replace') {
			this.entries = b.entries;
		} else {
			this.entries = {...this.entries, ...b.entries};
		}
	}
}


//-----------------------------------------------------------------------------
//	Project
//-----------------------------------------------------------------------------

const MSBuildProperties : Properties = {
	VisualStudioVersion:			"17.0",
	MSBuildToolsPath:				"$([MSBuild]::GetCurrentToolsDirectory())",
	MSBuildToolsPath32:				"$([MSBuild]::GetToolsDirectory32())",
	MSBuildToolsPath64:				"$([MSBuild]::GetToolsDirectory64())",
	MSBuildSDKsPath:				"$([MSBuild]::GetMSBuildSDKsPath())",
	MSBuildProgramFiles32:			"$([MSBuild]::GetProgramFiles32())",
	FrameworkSDKRoot:				"$([MSBuild]::GetRegistryValueFromView('HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Microsoft SDKs\\NETFXSDK\\4.8', 'InstallationFolder', null, RegistryView.Registry32))",
	MSBuildRuntimeVersion:			"4.0.30319",
	MSBuildFrameworkToolsPath:		"$(SystemRoot)\\Microsoft.NET\\Framework\\v$(MSBuildRuntimeVersion)\\",
	MSBuildFrameworkToolsPath32:	"$(SystemRoot)\\Microsoft.NET\\Framework\\v$(MSBuildRuntimeVersion)\\",
	MSBuildFrameworkToolsPath64:	"$(SystemRoot)\\Microsoft.NET\\Framework64\\v$(MSBuildRuntimeVersion)\\",
	MSBuildFrameworkToolsPathArm64:	"$(SystemRoot)\\Microsoft.NET\\FrameworkArm64\\v$(MSBuildRuntimeVersion)\\",
	MSBuildFrameworkToolsRoot:		"$(SystemRoot)\\Microsoft.NET\\Framework\\",
	SDK35ToolsPath:					"$([MSBuild]::GetRegistryValueFromView('HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Microsoft SDKs\\Windows\\v8.0A\\WinSDK-NetFx35Tools-x86', 'InstallationFolder', null, RegistryView.Registry32))",
	SDK40ToolsPath:					"$([MSBuild]::ValueOrDefault($([MSBuild]::GetRegistryValueFromView('HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Microsoft SDKs\\NETFXSDK\\4.8.1\\WinSDK-NetFx40Tools-x86', 'InstallationFolder', null, RegistryView.Registry32)), $([MSBuild]::GetRegistryValueFromView('HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Microsoft SDKs\\NETFXSDK\\4.8\\WinSDK-NetFx40Tools-x86', 'InstallationFolder', null, RegistryView.Registry32))))",
	WindowsSDK80Path:				"$([MSBuild]::GetRegistryValueFromView('HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Microsoft SDKs\\Windows\\v8.1', 'InstallationFolder', null, RegistryView.Registry32))",
	VsInstallRoot:					"$([MSBuild]::GetVsInstallRoot())",
	MSBuildToolsRoot:				"$(VsInstallRoot)\\MSBuild",
	MSBuildExtensionsPath:			"$([MSBuild]::GetMSBuildExtensionsPath())",
	MSBuildExtensionsPath32:		"$([MSBuild]::GetMSBuildExtensionsPath())",
	RoslynTargetsPath:				"$([MSBuild]::GetToolsDirectory32())\\Roslyn",
	VCTargetsPath:					"$([MSBuild]::ValueOrDefault('$(VCTargetsPath)','$(MSBuildExtensionsPath32)\\Microsoft\\VC\\v170\\'))",
	VCTargetsPath14:				"$([MSBuild]::ValueOrDefault('$(VCTargetsPath14)','$(MSBuildProgramFiles32)\\MSBuild\\Microsoft.Cpp\\v4.0\\V140\\'))",
	VCTargetsPath12:				"$([MSBuild]::ValueOrDefault('$(VCTargetsPath12)','$(MSBuildProgramFiles32)\\MSBuild\\Microsoft.Cpp\\v4.0\\V120\\'))",
	VCTargetsPath11:				"$([MSBuild]::ValueOrDefault('$(VCTargetsPath11)','$(MSBuildProgramFiles32)\\MSBuild\\Microsoft.Cpp\\v4.0\\V110\\'))",
	VCTargetsPath10:				"$([MSBuild]::ValueOrDefault('$(VCTargetsPath10)','$(MSBuildProgramFiles32)\\MSBuild\\Microsoft.Cpp\\v4.0\\'))",
	AndroidTargetsPath:				"$(MSBuildExtensionsPath32)\\Microsoft\\MDD\\Android\\V150\\",
	iOSTargetsPath:					"$(MSBuildExtensionsPath32)\\Microsoft\\MDD\\iOS\\V150\\",
//	MSBuildExtensionsPath:			"$(MSBuildProgramFiles32)\\MSBuild",
//	MSBuildExtensionsPath32:		"$(MSBuildProgramFiles32)\\MSBuild",
	MSBuildExtensionsPath64:		"$(MSBuildProgramFiles32)\\MSBuild",
	VSToolsPath:					"$(MSBuildProgramFiles32)\\MSBuild\\Microsoft\\VisualStudio\\v$(VisualStudioVersion)",
	WindowsKitsRoot:				"$([MSBuild]::GetRegistryValueFromView('HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows Kits\\Installed Roots', 'KitsRoot10', null, RegistryView.Registry32, RegistryView.Default))",
};

function getPropertyGroup(file?: xml.Element, condition?: string) {
	const elements = file?.firstElement();
	if (!elements)
		return;

	condition = condition ?? '';
	for (const i of elements.children) {
		if (xml.isElement(i) && i.name === 'PropertyGroup' && i.attributes.Condition === condition)
			return i;
	}
	
	const i = new xml.Element('PropertyGroup', condition ? {Condition: condition} : {});
	elements.add(i);
	return i;
}


export class MsBuildProject extends Project {
	private filtertree: Promise<FolderTree | undefined>;
	public	items:		Record<string, Items> = {};
	public	raw_xml?:	xml.Element;
	public	user_xml?:	xml.Element;
	public	imports:	Imports			= {all:[]};	//currently parsed imports
	public	schemas:	SchemaFile[]	= [];
	private project_dirty	= 0;
	private filter_dirty	= 0;
	private user_dirty		= 0;

	constructor(parent:any, type:string, name:string, fullpath: string, guid: string, private solution_dir: string) {
		super(parent, type, name, fullpath, guid);

		this.ready = this.loadProject();
		Extension.onChange(fullpath, (path: string) => {
			console.log("I've changed");
			this.loadProject();
		});
		
		const filterpath = this.fullpath + ".filters";
		this.filtertree = this.loadFilters(filterpath);
		Extension.onChange(filterpath, (path: string) => {
			console.log("Filter changed");
			this.filtertree = this.loadFilters(path);
		});
	}

	private normalItems() {
		return Object.keys(this.items).filter(i => !nonNormalItems.has(i) && !plainItems.has(i));
	}

	public getFolders(useFilters = true) : Promise<FolderTree | undefined> {
		if (useFilters)
			return this.filtertree;

		return this.ready.then(() => {
			const	foldertree = new FolderTree;
			for (const i of this.normalItems()) {
				for (const entry of this.items[i].entries)
					foldertree.add(entry.data.relativePath, entry);
			}
			return foldertree;
		});
	}

	private async readRuleFiles() {
		const pp = this.items["PropertyPageSchema"];
		const rules = pp ? pp.entries.map(i => SchemaFile.read(i.data.fullPath)) : [];

		const schemas = await Promise.all(rules).then(schemas => schemas.reduce((acc, i) => {
			if (i) {
				const name = i.attributes.Name;
				if (acc[name])
					acc[name].combine(i);
				else
					acc[name] = i;
			}
			return acc;
		}, {} as Record<string, SchemaFile>));

		this.schemas = Object.values(schemas);
		this.schemas.sort((a, b) => +(a.attributes.Order??0) - +(b.attributes.Order??0));
	}

	private makeProjectProps(fullPath:string, globals: Properties, locals?: string) : Promise<PropertyContext> {
		//phase1 : Evaluate environment variables

		const properties = new PropertyContext;

		properties.add_direct(Object.fromEntries(Object.keys(process.env).filter(k => /^[A-Za-z_]\w+$/.test(k)).map(k => [k, process.env[k]??'']))),
		properties.add_direct(globals);

		properties.setPath(fullPath);
		properties.makeGlobal(Object.keys(globals));
		if (locals)
			properties.makeLocal(locals.split(';'));

		const parsed = path.parse(this.fullpath);
		return properties.add({
			MSBuildProjectDirectory:	parsed.dir,
			MSBuildProjectExtension:	parsed.ext,
			MSBuildProjectFile:			parsed.base,
			MSBuildProjectFullPath:		this.fullpath,
			MSBuildProjectName:			parsed.name,
			SolutionDir: 				this.solution_dir + path.sep,
		}, true)
		.then(() => properties.add(MSBuildProperties, true))
		.then(() => properties);
	}

	private async loadProject(): Promise<void> {
		//this.raw_xml	= [];
		this.items		= {};
		this.imports 	= {all:[]};

		return xml_load(vscode.Uri.file(this.fullpath)).then(document => {
			this.raw_xml	= document;
			const root 		= document?.firstElement();
			if (root?.name == 'Project') {
/*
				this.attributes	= root.attributes;
				for (const element of root.children) {
					if (xml.isElement(element)) {
						switch (element.name) {
							case "PropertyGroup":
							case "Import":
							case "ImportGroup":
								this.raw_xml.push(element);
						}
					}
				}
*/
				let globals: Properties = {};
				for (const i of root.elements.ItemGroup) {
					if (i.attributes.Label == 'ProjectConfigurations') {
						globals = Configuration.make(i.elements.ProjectConfiguration.attributes.Include).properties;
						break;
					}
				}
				return this.makeProjectProps(this.fullpath, globals, root.attributes.TreatAsLocalProperty).then(async props => {
					await evaluatePropsAndImports(root.allElements(), props, this.imports, true);
					await readItems(root.allElements(), props, this.items, true);
					for (const i of this.imports.all) {
						const root = (await XMLCache.get(i))?.firstElement() as xml.Element;
						const prev = props.currentPath();
						props.setPath(i);
						await readItems(root.allElements(),
							props,
							this.items, false
						);
						props.setPath(prev);

					}
					if (this.items.ProjectReference) {
						for (const i of this.items.ProjectReference.entries) {
							const proj = this.parent.projects[metadata_value(i, 'Project')?.toUpperCase()];
							if (proj)
								this.addDependency(proj);
						}
					}
					console.log(`loaded ${this.fullpath}`);

					//don't wait for these things:
					this.readRuleFiles();
					
					xml_load(vscode.Uri.file(this.fullpath + ".user")).then(document => this.user_xml = document);
/*
					.then(document => {
						const root = document?.firstElement();
						if (root?.name == 'Project') {
							for (const i of root.children) {
								if (xml.isElement(i))
									this.user_xml.push(i);
							}
						}
					});
*/			
				});
			}
		});
	}

	private async saveProject(filename : string) {
		const root = this.raw_xml?.firstElement();
		if (!root)
			return;

		//organise item definitions by condition
		const definitions: Record<string, Record<string, any>> = {};
		for (const i in this.items) {
			for (const d of this.items[i].definitions) {
				if (d.isProject) {
					if (!(d.condition in definitions))
						definitions[d.condition] = {};
					definitions[d.condition][i] = d.data;
				}
			}
		}

		const element = new xml.Element('?xml', this.raw_xml?.attributes, [
			new xml.Element('Project', root.attributes, [
				this.items.ProjectConfiguration.entries2Xml(true, {Label: 'ProjectConfigurations'}),

				...root.allElements().filter(i => i.name == 'PropertyGroup' || i.name == 'Import' || i.name == 'ImportGroup'),

				...Object.keys(definitions)
					.map(i => new xml.Element('ItemDefinitionGroup', i ? {Condition: i} : {}, [
						...Object.keys(definitions[i]).map(j => new xml.Element(j, {}, definitions[i][j]))
					])),

				...Object.keys(this.items)
					.filter(i => !plainItems.has(i) && i != 'PropertyPageSchema')
					.map(i => this.items[i].entries2Xml(false, {})),

			])
		]);

		return xml_save(vscode.Uri.file(filename), element);
	}

	private async loadFilters(fullPath : string): Promise<FolderTree|undefined> {
		return this.ready.then(() => {
			const allfiles : Record<string, ProjectItemEntry> = {};
			for (const i of this.normalItems()) {
				if (this.items[i].definitions.length)
					for (const entry of this.items[i].entries)
						allfiles[entry.data.fullPath] = entry;
			}
			return loadFilterTree(fullPath, allfiles);
		});
	}

	public async dirtyFilters() {
		++this.filter_dirty;
	}

	public addSetting(source: string, name: string, value: string|undefined, condition: string | undefined, user: boolean, revert: boolean) : xml.Element | undefined {
		if (user)
			this.user_dirty += revert ? -1 : 1;
		else
			this.project_dirty += revert ? -1 : 1;

		let loc: xml.Element | undefined;

		if (source) {
			const d = this.items[source].getDefinition(condition || '', true);
			for (const i of d.data) {
				if (i.name === name) {
					loc = i;
					break;
				}
			}
			if (revert && value === '<inherit>') {
				array_remove(d.data, loc);
				return;
			} else if (loc) {
				loc.setText(value||'');
			} else {
				loc = new xml.Element(name, undefined, [value||'']);
				d.data.push(loc);
			}

		} else {
			const file = user ? this.user_xml : this.raw_xml;
			const d = getPropertyGroup(file, condition);
			if (d) {
				for (const i of d.children) {
					if (xml.isElement(i) && i.name === name) {
						loc = i;
						break;
					}
				}
				if (revert && value === '<inherit>') {
					array_remove(d.children, loc);
					return;
				} else if (loc) {
					loc.setText(value||'');
				} else {
					loc = new xml.Element(name, undefined, [value||'']);
					d.add(loc);
				}
			}
		}
		return loc as xml.Element;
	}

	public async evaluate(globals: Properties, final: boolean, file?: string): Promise<Sources> {
		const root	= this.raw_xml?.firstElement();
		const props	= await this.makeProjectProps(this.fullpath, globals, root?.attributes.TreatAsLocalProperty);
		const imports : Imports 	= {all:[]};

		const modified: Record<string, xml.Element>	= {};
		await evaluatePropsAndImports(
			[
				...root?.allElements()??[],
				...this.user_xml?.firstElement()?.allElements()??[]
			],
			props,
			imports,
			final,
			modified
		);

		const sources : Sources = {};
		sources[''] = CaseInsensitiveProxy(Object.fromEntries(Object.entries(props.properties).map(([k, v]) => [k, new Result(v, modified[k], 0)])));
		for (const i in this.items) {
			const entry 	= file ? this.items[i].getEntry(file) : undefined;
			const result	= await this.items[i].evaluate(props, final, entry);
			const use_loc	= !file || entry;
			sources[i] = Object.fromEntries(Object.entries(result[0]).map(([k, v]) => [k, new Result(v, use_loc ? result[1][k] : undefined, 0)]));
		}

		return sources;
	}

	public async getSetting(globals : Properties, name: string) {
		const root	= this.raw_xml?.firstElement();
		const props	= await this.makeProjectProps(this.fullpath, globals, root?.attributes.TreatAsLocalProperty);
		const imports : Imports 	= {all:[]};

		return evaluatePropsAndImports(
			[
				...root?.allElements()??[],
				...this.user_xml?.firstElement()?.allElements()??[]
			],
			props,
			imports,
			true
		).then(() => {
			return props.properties[name];
		});
	}

	public isLocal(result: Result) : boolean {
		if (!result.loc)
			return false;

		let p = result.loc;
		while (p.parent)
			p = p.parent;
		return p === this.raw_xml || p === this.user_xml;
		//const parent = result.loc?.parent;
		//return parent ? (this.user_xml.indexOf(parent) !== -1 || this.raw_xml.indexOf(parent) !== -1) : false;
	}

	public build(globals : Properties) {
		this.clean().then(() => {
			if (vscode.workspace.workspaceFolders) {
				const task = new vscode.Task(
					{ type: 'shell', task: 'compile' },
					vscode.workspace.workspaceFolders[0],
					'build project',
					'msbuild source',
					new vscode.ShellExecution(
						'${env:vsdir}\\MSBuild\\Current\\Bin\\msbuild',
						[
							...Object.keys(globals).filter(k => k !== 'file').map(k => `/property:${k}=${globals[k]}`),
							"/target:" + path.basename(this.name),
							globals.file,
						]
					),
					"$msbuild"
				);
				vscode.tasks.executeTask(task);
			}
		});
	}

	public async clean() {
		const promises = [] as Promise<any>[];

		if (this.project_dirty) {
			promises.push(this.saveProject(this.fullpath));
			//const parsed 	= path.parse(this.fullpath);
			//promises.push(this.saveProject(path.join(parsed.dir, parsed.name + '2' + parsed.ext)));
			this.project_dirty = 0;
		}

		if (this.user_dirty) {
			promises.push(xml_save(vscode.Uri.file(this.fullpath + ".user"), this.user_xml!));
			//new xml.Element('?xml', {version: '1.0', encoding: "utf-8"}, [
			//	new xml.Element('Project', {ToolsVersion: "14.0", xmlns:"http://schemas.microsoft.com/developer/msbuild/2003"}, this.user_xml)
			//])));
			this.user_dirty = 0;
		}

		if (this.filter_dirty) {
			const tree = await this.filtertree;
			if (tree)
				promises.push(saveFilterTree(tree, this.fullpath + ".filters"));
			this.filter_dirty = 0;
		}

		return Promise.all(promises);
	}

}

export class CPSProject extends MsBuildProject {

}
