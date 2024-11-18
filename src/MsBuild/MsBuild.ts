import * as vscode from 'vscode';
import * as path from "path";
import * as fs from "../vscode-utils/fs";
import * as xml from "../xml/xml";
import * as expression from "./expression";
import * as insensitive from '../shared/CaseInsensitive';
import * as utils from '../shared/utils';
import {ProjectItemEntry, Properties} from "../Project";
import {XMLCache, xml_load, xml_save, vsdir, createTask} from '../extension';

//-----------------------------------------------------------------------------
//	types
//-----------------------------------------------------------------------------

export type Settings	= Record<string, any>;
export type Origins		= Record<string, xml.Element>;

export interface Imports {
	[key:string]: string[];
	all: string[];
}

function ParseSDKKey(key: string) {
	const parts		= key.split(',');
	const version	= parts.find(p => p.trim().startsWith('Version='));
	return {
		identifier: parts[0].trim(),
		version: version ? version.split('=')[1] : undefined
	};
}

//-----------------------------------------------------------------------------
//	Properties
//-----------------------------------------------------------------------------

export class PropertyContext {
	public globals	= new Set<string>;
	public properties: Properties;
	
	constructor(properties: Properties = {}) {
		this.properties = insensitive.Record(properties);
	}

	public substitute(value: string, leave_undefined = false): Promise<string> {
		//\$\(
		//	(
		//		registry:[\\@\w]+
		//		|\w+
		//		|\[[\w.]+\]
		//	)
		//	(
		//		\)
		//		|\.\w+\(
		//		|::\w+\(
		//	)/g
		return utils.async_replace_back(value,/\$\((registry:[\\@\w]+|\w+|\[[\w.]+\])(\)|\.\w+\(|::\w+\()/g, async (m: RegExpExecArray, right:string) =>
			expression.substitutor(m, right, this.properties, leave_undefined)
		);
	}

	public async substitute_path(value: string): Promise<string> {
		return fs.toOSPath(await this.substitute(value, true));
	}

	public async get_fullpath(origpath: string): Promise<string> {
		const subspath = await this.substitute_path(origpath);
		return subspath.indexOf('$') === -1 ? path.resolve(this.properties.MSBUILDTHISFILEDIRECTORY, subspath) : '';
	}

	public async checkConditional(condition?: string) : Promise<boolean> {
		return !condition || await this.substitute(condition).then(condition => expression.Evaluate(condition));
	}

	public async parse(element: xml.Element, substitute: boolean, mods?: Origins) {
		for (const e of element.allElements()) {
			if (
				await this.checkConditional(e.attributes.Condition)) {
				const name = e.name.toUpperCase();
				if (!this.globals.has(name)) {
					this.properties[name] = await this.substitute(e.firstText() || '', !substitute);
					if (mods)
						mods[name] = e;
				}
			}
		}
	}

	public async add(props: Properties) {
		for (const i in props) {
			const name = i.toUpperCase();
			if (!this.globals.has(name))
				this.properties[name] = await this.substitute(props[i]);
		}
	}

	public addDirect(props: Properties) {
		for (const i in props)
			this.properties[i.toUpperCase()] = props[i];
	}

	public setPath(fullPath: string) {
		const parsed 	= path.parse(fullPath);
		this.properties.MSBUILDTHISFILEFULLPATH		= fullPath;
		this.properties.MSBUILDTHISFILEDIRECTORY	= parsed.dir + path.sep;
		this.properties.MSBUILDTHISFILENAME			= parsed.name;
		this.properties.MSBUILDTHISFILEEXTENSION	= parsed.ext;
		this.properties.MSBUILDTHISFILE				= parsed.base;
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

export async function evaluateImport(import_path: string, properties: PropertyContext, label = '', imports?: Imports, modified?: Origins) {
	const resolved	= await properties.get_fullpath(import_path);
	const files		= await fs.search(resolved);
	for (const i of files) {
		if (imports && imports.all.indexOf(i) !== -1) {
			console.log(`Double import: ${i}`);
			continue;
		}

		const root = (await XMLCache.get(i))?.firstElement();
		if (root?.name == 'Project') {
			const prev = properties.currentPath();
			properties.setPath(i);
			//console.log(`vscode://file/${i.replaceAll(' ','%20')}`);
			await evaluatePropsAndImports(root.allElements(), properties, imports, modified);
			if (prev)
				properties.setPath(prev);

			if (imports) {
				if (!(label in imports))
					imports[label] = [];
				imports[label].push(i);
				imports.all.push(i);
			}
		} else {
			console.log(`Invalid import: ${i} from ${import_path}`);
		}
	}
}

export async function evaluatePropsAndImports(raw_xml: xml.Element[], properties: PropertyContext, imports?: Imports, modified?: Origins) : Promise<void> {
	for (const element of raw_xml) {
		if (await properties.checkConditional(element.attributes.Condition)) {

			if (element.name === 'PropertyGroup') {
				await properties.parse(element, true, modified);

			} else if (element.name === "Import") {
				await evaluateImport(element.attributes.Project, properties, '', imports, modified);

			} else if (element.name === "ImportGroup") {
				const label = element.attributes.Label??'';
				for (const item of element.children) {
					if (xml.isElement(item) && item.name == "Import" && await properties.checkConditional(item.attributes.Condition))
						await evaluateImport(item.attributes.Project, properties, label, imports, modified);
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
	"Reference",			"PackageReference",
	"BuildMacro", 			"AvailableItemName",
	"AssemblyMetadata", 	"BaseApplicationManifest", "CodeAnalysisImport",
	"COMReference", 		"COMFileReference",
	"InternalsVisibleTo", 	"NativeReference", 		"TrimmerRootAssembly", "Using", "Protobuf",
	"ProjectConfiguration", "ProjectCapability",	"ProjectTools",
	"CustomBuildStep",    	"PreBuildEvent",  		"PreLinkEvent",    "PostBuildEvent",
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

export const ItemMode = {
	File:	0,
	Text:	1,
	Other:	2,
};
export type ItemMode = typeof ItemMode[keyof typeof ItemMode];

//WELL-KNOWN ITEM METADATA
//%(FullPath)					Contains the full path of the item.
//%(RootDir)					Contains the root directory of the item.
//%(Filename)					Contains the file name of the item, without the extension.
//%(Extension)					Contains the file name extension of the item.
//%(RelativeDir)				Contains the path specified in the Include attribute, up to the final backslash (\).
//%(Directory)					Contains the directory of the item, without the root directory.
//%(RecursiveDir)				If the Include attribute contains the wildcard **, this metadata specifies the part of the path that replaces the wildcard
//%(Identity)					The item specified in the Include attribute.
//%(ModifiedTime)				Contains the timestamp from the last time the item was modified.
//%(CreatedTime)				Contains the timestamp from when the item was created.
//%(AccessedTime)				Contains the timestamp from the last time the item was accessed	.2004-08-14 16:52:36.3168743
//%(DefiningProjectFullPath)	Contains the full path of the project file (or imported file) that defines this item.
//%(DefiningProjectDirectory)	Contains the project directory of the project file (or imported file) that defines this item.
//%(DefiningProjectName)		Contains the name of the project file (or imported file) that defines this item (without the extension).
//%(DefiningProjectExtension)	Contains the extension of the project file (or imported file) that defines this item.


function getItemMode(name: string) {
	return plainItems.has(name) ? ItemMode.Text : nonNormalItems.has(name) ? ItemMode.Other : ItemMode.File;
}

function getLink(element: xml.Element) {
	const link 		= fs.toOSPath(element.attributes.Link ?? element.elements.Link?.firstText());
	if (link)
		return link;

	const linkBase 	= fs.toOSPath(element.attributes.LinkBase ?? element.elements.LinkBase?.firstText());
	if (linkBase)
		return path.join(linkBase, "%(RecursiveDir)%(Filename)%(Extension)");
}

function fixRelativePath(relativePath: string, link?: string): string {
	if (link) {
		const parsed = path.parse(relativePath);
		return link
			.replace("%(Extension)", parsed.ext)
			.replace("%(Filename)", parsed.name)
			.replace("%(RecursiveDir)", parsed.dir);
	}
	return relativePath;
}

async function evaluate_data(items: xml.Element[], settings: Settings, properties: PropertyContext, modified: Origins) {

	async function evaluate(item: xml.Element) {
		if (item.firstElement()) {
			const result : Record<string, any> = {};
			for (const i of item.children) {
				if (xml.isElement(i))
					result[item.name] = await evaluate(i);
			}
			return result;
	
		} else {
			const text = item.allText().join();
			return properties.substitute(text)
				.then(subs => utils.async_replace_back(subs, /%\((\w+)(\))/g, async (m: RegExpExecArray, right:string) => {
					const replace = await settings[m[1]];
					if (!replace) {
						console.log(`no % substitute for ${m[1]}`);
						return m[0] + right;
					}
					return replace + right;
				}));
		}
	}

	for (const i of items) {
		if (await properties.checkConditional(i.attributes.Condition)) {
			settings[i.name] = await evaluate(i);
			modified[i.name] = i;
		}
	}
}

class XMLProjectItemEntry implements ProjectItemEntry {
	constructor(public name:string, public data: Record<string, any>) {
	}

	value(name: string) {
		const elements = this.data.elements as xml.Element[];
		return elements.find(e => e.name === name)?.firstText() || '';
	}
}

export function hasMetadata(entry: ProjectItemEntry) : entry is XMLProjectItemEntry {
	return  Array.isArray(entry.data.elements);
}

function metadata(entry: ProjectItemEntry) : xml.Element[]{
	if (Array.isArray(entry.data.elements))
		return entry.data.elements;
	console.log("bad metadata!");
	return [];
}

export function metadata_value(entry: ProjectItemEntry, name: string) {
	return metadata(entry).find(e => e.name === name)?.firstText() || '';
}

type Definition = {
	condition: 	string;
	source?:	xml.Element;
	data: 		xml.Element[];
	isProject: 	boolean;
};

class DeferredStat {
	stat?: Thenable<vscode.FileStat | undefined>;
	constructor(public path: string) {}
	then(f: (s: vscode.FileStat|undefined) => any) {
		return new Promise((resolve, reject) => {
			if (!this.stat)
				this.stat = fs.getStat(this.path);
			return resolve(this.stat.then(f));
		});
	}
}

export class Items {
	public	definitions: Definition[] = [];
	public 	entries: ProjectItemEntry[] = [];

	constructor(public name: string, public mode: ItemMode) {}

	public addDefinition(condition:string, data: xml.Element, isProject:boolean) {
		this.definitions.push({condition: condition, source: data, data: data.allElements(), isProject: isProject});
	}

	public getDefinition(condition: string, isProject:boolean) : Definition {
		for (const d of this.definitions) {
			if (d.condition === condition && d.isProject == isProject)
				return d;
		}
		const d = {condition: condition, data: [], isProject: isProject};
		this.definitions.push(d);
		return d;
	}

	public async evaluate(properties: PropertyContext, entry?: ProjectItemEntry) : Promise<[Settings, Origins]> {
		const modified:	Origins		= {};
		let settings:	Settings	= {};

		if (entry) {
			const fullPath 	= entry.data.fullPath;
			const parsed 	= path.parse(fullPath);
			const stat 		= new DeferredStat(fullPath);
			settings = {
				get FullPath()					{ return fullPath; },
				get RootDir()					{ return parsed.root;},
				get Filename()					{ return parsed.name;},
				get Extension()					{ return parsed.ext;},
				get RelativeDir()				{ return entry.data.relativePath;},
				get Directory()					{ return parsed.dir;},
				get RecursiveDir()				{ return path.dirname(entry.data.relativePath);},
				get Identity()					{ return "Identity";},
				get ModifiedTime()				{ return stat.then(s => s?.mtime); },
				get CreatedTime()				{ return stat.then(s => s?.ctime); },
				get AccessedTime()				{ return stat.then(s => s?.mtime); },
				get DefiningProjectFullPath()	{ return "DefiningProjectFullPath";},
				get DefiningProjectDirectory()	{ return "DefiningProjectDirectory";},
				get DefiningProjectName()		{ return "DefiningProjectName";},
				get DefiningProjectExtension()	{ return "DefiningProjectExtension";},
			};
		}

		for (const d of this.definitions) {
			if (await properties.checkConditional(d.condition))
				await evaluate_data(d.data, settings, properties, modified);
		}
		if (entry)
			await evaluate_data(metadata(entry), settings, properties, modified);
		return [settings, modified];
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

	public includeFile(basePath: string, fullPath: string, data?: xml.Element, link?:string) {
		const item = this.entries.find(e => e.data.fullPath === fullPath);
		if (item) {
			if (data)
				item.data.elements = [...item.data.elements, ...data.allElements()];
		} else {
			this.entries.push(new XMLProjectItemEntry(
				path.basename(fullPath),
				{
					fullPath: 		fullPath,
					relativePath: 	fixRelativePath(path.relative(basePath, fullPath), link),
					item: 			this,
					source:			data,
					elements:		data?.allElements(),
				}
			));
		}
	}

	public async includeFiles(basePath: string, value: string, exclude: string | undefined, data: xml.Element, link?:string) {
		const excludes	= exclude?.split(";");
		for (let pattern of value.split(';')) {
			if ((pattern = pattern.trim())) {
				for (const filepath of await fs.search(path.resolve(basePath, pattern), excludes))
					this.includeFile(basePath, filepath, data, link);
			}
		}
	}

	public removeFiles(basePath: string, value: string) {
		const exclude = new fs.Glob(value.split(";").map(s => path.join(basePath, s)));
		this.entries = this.entries.filter(e => !exclude.test(e.data.fullPath));
	}

	public updateFiles(basePath: string, value: string, data: xml.Element, link?:string) {
		const update	= new fs.Glob(value.split(";").map(s => path.join(basePath, s)));
		for (const entry of this.entries) {
			if (update.test(entry.data.fullPath)) {
				const relativePath 		= fixRelativePath(entry.data.relativePath, link);
				entry.name 				= path.basename(relativePath);
				entry.data.relativePath	= relativePath;
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

	public addSetting(name: string, value: string|undefined, condition: string | undefined, revert: boolean) : xml.Element | undefined {
		let loc: xml.Element | undefined;

		const d = this.getDefinition(condition || '', true);
		for (const i of d.data) {
			if (i.name === name) {
				loc = i;
				break;
			}
		}
		if (revert && value === '<inherit>') {
			utils.array_remove(d.data, loc);
			return;
			
		} else if (loc) {
			loc.setText(value||'');
		} else {
			loc = new xml.Element(name, undefined, [value||'']);
			d.data.push(loc);
		}

		return loc as xml.Element;
	}
}


function MakeItemsProxy(items: Record<string, Items>) {
	return new Proxy(items, {
		get(target, name: string) {
			if (!(name in target)) {
				const lower = name.toLowerCase();
				const found = Object.keys(target).find(e => e.toLowerCase() === lower);
				if (found)
					name = found;
				else {
					const mode = getItemMode(name);
					target[name] = new Items(name, mode);
				}
			}
			return target[name];
		},
		has(target, name: string) {
			if (name in target)
				return true;
			const lower = name.toLowerCase();
			return !!Object.keys(target).find(e => e.toLowerCase() === lower);
		}
	});
}

export async function readItems(elements: xml.Element[], properties: PropertyContext, allitems: Record<string, Items>, isProject: boolean): Promise<undefined> {
	//phase4 : items
/*
	function getItems(name: string) {
		if (!(name in allitems)) {
			const lower = name.toLowerCase();
			const found = Object.keys(allitems).find(e => e.toLowerCase() === lower);
			if (found)
				name = found;
			else {
				const mode = getItemMode(name);
				allitems[name] = new Items(name, mode);
			}
		}
		return allitems[name];
	}
*/
	const basepath 	= properties.properties.MSBUILDTHISFILEDIRECTORY;

	for (const element of elements) {
		if (element.name === "ItemDefinitionGroup") {
			const condition = element.attributes.Condition ?? '';
			for (const item of element.allElements())
				allitems[item.name].addDefinition(condition, item, isProject);

		} else if (element.name === 'ItemGroup') {//} && await properties.checkConditional(element.attributes.Condition)) {
			for (const item of element.allElements()) {
				const name	= item.name;
				const items = allitems[name];

				if (name === "Reference" && item.attributes.Include) {
					const include	= await properties.substitute_path(item.attributes.Include);
					const sdk		= ParseSDKKey(include);
					items.includePlain(sdk.identifier, {version: sdk.version});

				} else if (name === "PackageReference" && item.attributes.Include && items.entries.length == 0 && await fs.exists(path.join(basepath, 'packages.config'))) {
					const config = await XMLCache.get(path.join(basepath, 'packages.config'));
					if (config) {
						for (const e of config.elements.packages.allElements())
							items.includePlain(e.attributes.id, {version: e.attributes.version});
					}

				} else if (items.mode == ItemMode.Text && item.attributes.Include) {
					const include = await properties.substitute(item.attributes.Include);
					items.includePlain(include, {
						source:	item,
						...Object.fromEntries(item.allElements().filter(i => !i.firstElement()).map(i => [i.name, i.allText().join()]))
					});
	
				} else {
					if (item.attributes.Include) {
						const include = properties.substitute_path(item.attributes.Include);
						const excludes = item.attributes.Exclude && properties.substitute_path(item.attributes.Exclude);
						await items.includeFiles(basepath, await include, await excludes, item, getLink(item));
					}
				
					if (item.attributes.Remove)
						items.removeFiles(basepath, await properties.substitute_path(item.attributes.Remove));
				
					if (item.attributes.Update)
						items.updateFiles(basepath, await properties.substitute_path(item.attributes.Update), item, getLink(item));
				}
			}
		}
	}
}


//-----------------------------------------------------------------------------
//	Project
//-----------------------------------------------------------------------------

const MSBuildProperties : Properties = {
	VisualStudioVersion:			"17.0",
	MSBuildToolsVersion:			"Current",
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

export function addSetting(file: xml.Element|undefined, name: string, value: string|undefined, condition: string | undefined, revert: boolean) : xml.Element | undefined {
	let loc: xml.Element | undefined;

	const d = getPropertyGroup(file, condition);
	if (d) {
		for (const i of d.children) {
			if (xml.isElement(i) && i.name === name) {
				loc = i;
				break;
			}
		}
		if (revert && value === '<inherit>') {
			utils.array_remove(d.children, loc);
			return;

		} else if (loc) {
			loc.setText(value||'');
		} else {
			loc = new xml.Element(name, undefined, [value||'']);
			d.add(loc);
		}
	}
	return loc as xml.Element;
}


async function getExtAssoc(pp: Items) {
	const ext_assoc:	Record<string, string> = {};
	const content:		Record<string, string> = {};

	await Promise.all(pp.entries.map(i => XMLCache.get(i.data.fullPath).then(doc => {
		const root			= doc?.firstElement();
		const FileExtension	= root?.elements.FileExtension;
		const ContentType	= root?.elements.ContentType;
		if (ContentType) {
			for (const i of ContentType)
				content[i.attributes.Name] = i.attributes.ItemType;
		}
		if (FileExtension) {
			for (const i of FileExtension) {
				const itemtype = content[i.attributes.ContentType];
				for (const j of i.attributes.Name.split(';'))
					ext_assoc[j] = itemtype;
			}
		}
	})));
	return ext_assoc;
}

export class Project {
	public	raw_xml?:	xml.Element;
	public	items: 		Record<string, Items> 	= {};
	public	imports:	Imports					= {all:[]};	//currently parsed imports
	public 	ext_assoc	= new utils.Lazy(async () => getExtAssoc(this.items.PropertyPageSchema));

//	constructor() {}

	get root() {
		return this.raw_xml?.firstElement();
	}

	public async load(fullpath: string) {
		this.items		= MakeItemsProxy({});
		this.imports 	= {all:[]};
		await xml_load(fullpath).then(xml => this.raw_xml = xml);
	}

	public async makeProjectProps(fullPath:string, globals: Properties) : Promise<PropertyContext> {
		const properties = new PropertyContext;

		//phase1 : Evaluate environment variables
		properties.addDirect(Object.fromEntries(Object.keys(process.env).filter(k => /^[A-Za-z_]\w+$/.test(k)).map(k => [k, process.env[k]??'']))),

		properties.addDirect(globals);
		properties.setPath(fullPath);
		properties.makeGlobal(Object.keys(globals));

		const locals = this.root?.attributes.TreatAsLocalProperty;
		if (locals)
			properties.makeLocal(locals.split(';'));

		const parsed = path.parse(fullPath);
		await properties.add({
			MSBuildProjectDirectory:	parsed.dir,
			MSBuildProjectExtension:	parsed.ext,
			MSBuildProjectFile:			parsed.base,
			MSBuildProjectFullPath:		fullPath,
			MSBuildProjectName:			parsed.name,
			Sdk:						this.root?.attributes.Sdk ?? '',
		});
		await properties.add(MSBuildProperties);
		return properties;
	}

	public async save(filename : string) {
		const root = this.root;
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

				...Object.values(this.items)
					.filter(i => i.mode == ItemMode.File)
					.map(i => i.entries2Xml(false, {})),

			])
		]);

		return xml_save(filename, element);
	}

	public addItem(name: string) {
		return this.items[name] ??= new Items(name, getItemMode(name));
	}

	public async import(importPath : string, props: PropertyContext, label = '') {
		return evaluateImport(importPath, props, label, this.imports);
	}

	public async evaluatePropsAndImports(props: PropertyContext) {
		return evaluatePropsAndImports(this.root!.allElements(), props, this.imports);
	}

	public async readItems(props: PropertyContext) {
		return readItems(this.root?.allElements()??[], props, this.items, true);
	}

	public async readImportedItems(props: PropertyContext) {
		for (const i of this.imports.all) {
			const root = (await XMLCache.get(i))?.firstElement();
			const prev = props.currentPath();
			props.setPath(i);
			await readItems(root?.allElements()||[], props, this.items, false);
			props.setPath(prev);
		}
	}

	public async getSetting(user: xml.Element|undefined, props: PropertyContext, name: string) {
		const imports : Imports 	= {all:[]};

		await evaluatePropsAndImports(
			[
				...this.root?.allElements()??[],
				...user?.firstElement()?.allElements()??[]
			],
			props,
			imports
		);
		return props.properties[name];
	}

	public build(target: string, globals: Properties) {
		const solutionPath = globals.file;
		delete globals.file;
		const task = createTask(target, target, solutionPath, globals);
		vscode.tasks.executeTask(task);
	}
}
