import * as vscode from 'vscode';
import * as path from "path";
import * as fs from "./vscode-utils/fs";
import * as xml from "./xml/xml";
import * as MsBuild from './MsBuild';
import * as nuget from './nuget';

import {Project, ProjectConfiguration, Folder, FolderTree, Properties, ProjectItemEntry, makeFileEntry} from "./Project";
import {xml_load, xml_save, vsdir} from './extension';

//-----------------------------------------------------------------------------
//	Project
//-----------------------------------------------------------------------------

export class MsBuildProjectBase extends Project {
	public	msbuild:	MsBuild.Project;
	public	user_xml?:	xml.Element;
	private project_dirty	= 0;
	private user_dirty		= 0;
	private	nuget_feeds: nuget.Feed[] = [];

	constructor(type:string, name:string, fullpath: string, guid: string, solution_dir: string) {
		super(type, name, fullpath, guid, solution_dir);
		this.msbuild 	= new MsBuild.Project;
		this.ready		= this.load();

		fs.onChange(fullpath, (path: string) => fs.stat_reject(path).then(
			stat => {
				if (new Date().getTime() - stat.mtime < 10 * 1000) {
					console.log("I've (really?) changed");
					this.ready		= this.load();
				}
			},
			error => console.log(error)
		));

		xml_load(this.fullpath + ".user").then(doc => this.user_xml = doc);
	}

	public dirty() {
		++this.project_dirty;
		super.dirty();
	}

	public async nugetFeeds() {
		if (this.nugetFeeds.length == 0)
			this.nuget_feeds = await nuget.getFeeds(this.fullpath);
        return this.nuget_feeds;
    }

	async preload(root: xml.Element) : Promise<MsBuild.PropertyContext> {
		return this.makeProjectProps({});
	}

	async postload(props: MsBuild.PropertyContext) {
		await this.msbuild.readItems(props);
		this.msbuild.readImportedItems(props);

		if ('ProjectReference' in this.msbuild.items) {
			for (const i of this.msbuild.items.ProjectReference.entries || []) {
				if (MsBuild.hasMetadata(i)) {
					const proj = Project.all[i.value('Project')?.toUpperCase()];
					if (proj)
						this.addDependency(proj);
				}
			}
		}
	}

	async load() : Promise<void> {
		await this.msbuild.load(this.fullpath);

		const root 	= this.msbuild.root;
		if (root?.name == 'Project') {
			const props = await this.preload(root);
			await this.msbuild.evaluatePropsAndImports(props);
			await this.postload(props);
			console.log(`loaded ${this.fullpath}`);
		}
	}

	public getFolders(view: string) : Promise<FolderTree> {
		return this.ready.then(() => {
			const	foldertree = new FolderTree;
			if (view == 'items') {
				for (const i in this.msbuild.items) {
					if (this.msbuild.items[i].entries.find(i => i.data.fullPath)) {
						const folder = new Folder(i);
						folder.entries = this.msbuild.items[i].entries;
						foldertree.root.addFolder(folder);
					}
				}
			} else {
				const allfiles : Record<string, ProjectItemEntry> = {};
				for (const i of Object.values(this.msbuild.items)) {
					if (i.name == 'Folder') {
						for (const j of i.entries)
							foldertree.addDirectory(j.data.relativePath);

					} else if (i.mode === MsBuild.ItemMode.File) {
						for (const entry of i.entries)
							allfiles[entry.data.fullPath] = entry;
					}
				}
				for (const entry of Object.values(allfiles)) {
					if (entry.data.relativePath) {
						let p = entry.data.source;
						if (!p) {
							console.log("nope");
						} else {
							while (p.parent)
								p = p.parent;
							if (p === this.msbuild.raw_xml)
								foldertree.add(entry.data.relativePath, entry);
						}
					}
				}
			}
			return foldertree;
		});
	}

	protected async makeProjectProps(globals: Properties) {
		return this.msbuild.makeProjectProps(this.fullpath, {...globals, SolutionDir: this.solution_dir + path.sep});
	}

	public addSetting(source: string, name: string, value: string|undefined, condition: string | undefined, persist: string, revert: boolean) : xml.Element | undefined {
		let file;
		if (persist === 'UserFile') {
			this.user_dirty += revert ? -1 : 1;
			file = this.user_xml;
		} else if (persist === 'ProjectFile') {
			this.project_dirty += revert ? -1 : 1;
			file = this.msbuild.raw_xml;
		}

		return source
			? this.msbuild.items[source].addSetting(name, value, condition, revert)
			: MsBuild.addSetting(file, name, value, condition, revert);
	}

	public async getSetting(globals : Properties, name: string) {
		return this.msbuild.getSetting(this.user_xml, await this.makeProjectProps(globals), name);
	}

	public async evaluateProps(globals: Properties) : Promise<[MsBuild.PropertyContext, MsBuild.Origins]> {
		const props = await this.makeProjectProps(globals);
		const modified: MsBuild.Origins	= {};
		await MsBuild.evaluatePropsAndImports(
			[
				...this.msbuild.root?.allElements()??[],
				...this.user_xml?.firstElement()?.allElements()??[]
			],
			props,
			undefined,
			modified
		);

		return [props, modified];
	}

	public isLocal(loc: xml.Element) : boolean {
		while (loc.parent)
			loc = loc.parent;
		return loc === this.msbuild.raw_xml || loc === this.user_xml;
	}

	public async build(globals : Properties) {
		await this.clean();
		return this.msbuild.build(this.name, globals);
	}

	public async deploy(globals : Properties) {
		await this.clean();
		return this.msbuild.build(this.name + ':deploy', globals);
	}

	public async clean() {
		const promises = [] as Promise<any>[];

		if (this.project_dirty) {
			promises.push(this.msbuild.save(this.fullpath));
			this.project_dirty = 0;
		}

		if (this.user_dirty) {
			promises.push(xml_save(this.fullpath + ".user", this.user_xml!));
			this.user_dirty = 0;
		}

		await Promise.all(promises);
	}

	public validConfig(config: ProjectConfiguration) {
		return !('ProjectConfiguration' in this.msbuild.items)
			|| !!this.msbuild.items.ProjectConfiguration.entries.find(i => i.data.Configuration === config.Configuration && i.data.Platform === config.Platform);
	}

	public addFile(name:string, file: string): boolean {
		return false;
	}
	public removeFile(file: string) {
		return false;
	}
	public configurationList() : string[] {
		return 'ProjectConfiguration' in this.msbuild.items
			? [...new Set(this.msbuild.items.ProjectConfiguration.entries.map(i => i.data.Configuration))]
			: super.configurationList();
	}
	public platformList() : string[] {
		return 'ProjectConfiguration' in this.msbuild.items
			? [...new Set(this.msbuild.items.ProjectConfiguration.entries.map(i => i.data.Platform))]
			: super.platformList();
	}
}

export class MsBuildProject extends MsBuildProjectBase {
	constructor(parent:any, type:string, name:string, fullpath: string, guid: string, solution_dir: string) {
		super(type, name, fullpath, guid, solution_dir);
	}

	async preload(root: xml.Element) : Promise<MsBuild.PropertyContext> {
		const globals: Properties = {};

		// try and get first configuration
		if (root.elements.ItemGroup) {
			for (const i of root.elements.ItemGroup) {
				if (i.attributes.Label == 'ProjectConfigurations') {
					const parts = i.elements.ProjectConfiguration.attributes.Include.split('|');
					globals.Configuration	= parts[0];
					globals.Platform		= parts[1];
					break;
				}
			}
		}
		return this.makeProjectProps(globals);
	}
}

export function ManagedProjectMaker(language: string) {
	return class P extends MsBuildProjectBase {
		constructor(parent:any, type:string, name:string, fullpath: string, guid: string, solution_dir: string) {
			super(type, name, fullpath, guid, solution_dir);
		}
		async postload(props: MsBuild.PropertyContext) {
			await this.msbuild.import(`${vsdir}\\MSBuild\\Microsoft\\VisualStudio\\Managed\\Microsoft.${language}.DesignTime.targets`, props);
			await super.postload(props);
		}
	};
}

//Source Files (`.cs`):
//- All `.cs` files in the project root directory and its subdirectories are automatically included for compilation.
//- By default, the project system looks for a file named `Program.cs` as the entry point for console applications.
//
//Resources:
//- Resource files (e.g., `.resx`, `.resources`) in the project root directory or in a directory named `Resources` or `Properties` are automatically included as resources.
//
//Content Files:
//- Files in the project root directory or in a directory named `Content` are automatically included as content files and copied to the output directory during build.
//
//Web Assets:
//- For web projects (ASP.NET Core), files in the `wwwroot` directory are treated as static web assets and are included in the published output.
//
//Configuration Files:
//- Files with extensions like `.json`, `.xml`, `.config` in the project root directory are typically included as configuration files.
//
//Test Files:
//- For test projects, files in directories named `Tests` or ending with `.Tests` are automatically included as test files.
//
//Globbing Patterns:
//- The project system uses globbing patterns to include or exclude files.
//- For example, `**/*.cs` includes all `.cs` files recursively, while `!obj/**` excludes the `obj` directory and its contents.

//"*": "Content",
//"cs": "Compile",
//"cpp": "ClCompile",
//"cc": "ClCompile",
//"c": "ClCompile",
//"h": "ClInclude",
//"hpp": "ClInclude",
//"vb": "Compile",
//"fs": "Compile",
//"ts": "TypeScriptCompile"


//<Project>
//  <!-- Implicit top import -->
//  <Import Project="Sdk.props" Sdk="Microsoft.NET.Sdk" />
//  ...
//  <!-- Implicit bottom import -->
//  <Import Project="Sdk.targets" Sdk="Microsoft.NET.Sdk" />
//</Project>
//
//On a Windows machine, the Sdk.props and Sdk.targets files can be found in the %ProgramFiles%\dotnet\sdk\[version]\Sdks\Microsoft.NET.Sdk\Sdk folder.

function getSdkPath() {
	const version	= '8.0.302';
	return `${process.env.ProgramFiles}\\dotnet\\sdk\\${version}\\Sdks\\Microsoft.NET.Sdk\\Sdk`;
}

export function CPSProjectMaker(language: string, ext: string) {
	return class P extends MsBuildProjectBase {
		constructor(parent:any, type:string, name:string, fullpath: string, guid: string, solution_dir: string) {
			super(type, name, fullpath, guid, solution_dir);

			fs.onChange(path.join(path.dirname(this.fullpath), '**\\*'), (filepath: string, mode: number) => {
				console.log("something's changed");
				if (mode === 1) {
					if (filepath.endsWith(ext)) {
						this.msbuild.addItem('Compile').includeFile(path.dirname(this.fullpath), filepath, this.msbuild.root!);
						this._onDidChange.fire(this.fullpath);	// not really dirty
						//this.dirty();
					}
				}
			});
		}

		async preload(root: xml.Element) {
			const props		= await super.preload(root);
			await this.msbuild.import(path.join(getSdkPath(), "Sdk.props"), props);

			//Element			Include glob	Exclude glob									Remove glob
			//Compile			**/*.cs (etc)	**/*.user; **/*.*proj; **/*.sln; **/*.vssscc	N/A
			//EmbeddedResource	**/*.resx		**/*.user; **/*.*proj; **/*.sln; **/*.vssscc	N/A
			//None				**/*			**/*.user; **/*.*proj; **/*.sln; **/*.vssscc	**/*.cs; **/*.resx

			const basePath	= path.dirname(this.fullpath);
			await this.msbuild.addItem('Compile').includeFiles(basePath, `**\\*.${ext}`, undefined, root);
			await this.msbuild.addItem('EmbeddedResource').includeFiles(basePath, '**\\*.resx', undefined, root);
			const None = this.msbuild.addItem('None');
			await None.includeFiles(basePath, `**\\*`, '**\\*.user;**\\*.*proj;**\\*.sln;**\\*.vssscc', root);
			None.removeFiles(basePath,  `**\\*.${ext};**/*.resx`);

			return props;
		}

		async postload(props: MsBuild.PropertyContext) {
			await this.msbuild.import(path.join(getSdkPath(), "Sdk.targets"), props);
			await this.msbuild.import(`${vsdir}\\MSBuild\\Microsoft\\VisualStudio\\Managed\\Microsoft.${language}.DesignTime.targets`, props);
			super.postload(props);
		}
	
		public async evaluateProps(globals: Properties) : Promise<[MsBuild.PropertyContext, MsBuild.Origins]> {
			const props 	= await this.makeProjectProps(globals);
			const modified: MsBuild.Origins	= {};
			const sdkpath	= getSdkPath();

			await MsBuild.evaluateImport(path.join(sdkpath, "Sdk.props"), props);
			await MsBuild.evaluatePropsAndImports(
				this.msbuild.root?.allElements()??[],
				props,
				undefined,
				modified
			);
			await MsBuild.evaluateImport(path.join(sdkpath, "Sdk.targets"), props);
			return [props, modified];
		}

//HKLM\System\CurrentControlSet\Services\bam\State\UserSettings\S-1-5-21-4186269171-837160500-987669143-1003\\Device\HarddiskVolume4\Windows\System32\dllhost.exe
//10,d5,c2,a1,a9,0f,db,01,
//00,00,00,00,00,00,00,00,
//00,00,00,00,02,00,00,00

//HKLM\System\CurrentControlSet\Services\bam\State\UserSettings\S-1-5-21-4186269171-837160500-987669143-1003\36e00bac-ea8d-483e-b9f3-6df0e6067fd8_apkshysghzkxy
//48,0a,50,e1,96,0f,db,01,
//00,00,00,00,00,00,00,00,
//01,00,00,00,02,00,00,00

//HKCU\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\SystemAppData\36e00bac-ea8d-483e-b9f3-6df0e6067fd8_apkshysghzkxy\HAM\AUI\App\V1\LU\PCT
//HKCU\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\SystemAppData\36e00bac-ea8d-483e-b9f3-6df0e6067fd8_apkshysghzkxy\HAM\AUI\App\V1\LU\PCT
//HKCU\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\SystemAppData\36e00bac-ea8d-483e-b9f3-6df0e6067fd8_apkshysghzkxy\HAM\AUI\App\V1\LU\ICT

		public debug(settings: Properties) {
			let cwd = settings.Platform === 'Any CPU'
				? path.join(path.dirname(this.fullpath), 'bin', settings.Configuration, 'net8.0')
				: path.join(path.dirname(this.fullpath), 'bin', settings.Platform, settings.Configuration);

			return {
				type:	'cppvsdbg',
				program: path.join(cwd, this.name + '.exe'),
				cwd,
				symbolSearchPath: cwd,
				symbolOptions: {
					searchPaths: [cwd],
					searchMicrosoftSymbolServer: true
				},
				args:	[],
			};

			const package_id = '36e00bac-ea8d-483e-b9f3-6df0e6067fd8_apkshysghzkxy';
			cwd = path.join(path.dirname(this.fullpath), 'bin', settings.Platform, settings.Configuration, 'AppX');
			return {
				type: 		"cppvsdbg",
				program: 	path.join(cwd, this.name + '.exe'),
				//program: 	"C:\\Windows\\System32\\WWAHost.exe",
				args: 		[
					//"-ServerName:App.Appx36e00bac-ea8d-483e-b9f3-6df0e6067fd8_apkshysghzkxy!App",
					"-ServerName:App.AppXqw41hd353ncaz1d87w9ns8vqhg7c1ars.mca"
				],
				cwd,
				environment: [
					{
						"name": "LOCALAPPDATA",
						"value": `${process.env.LOCALAPPDATA}\\Packages\\${package_id}\\AC`
					}
				],
	
			};
			//return {
			//	type: 'dotnet',
			//	projectPath: this.fullpath,
			//};
		}
	
	};
}

async function makeFolder(dirname: string, name: string) : Promise<Folder> {
	return fs.readDirectory(dirname).then(async files => {
		const folder = new Folder(name);
		folder.folders = await Promise.all(files.filter(i => i[1] == vscode.FileType.Directory).map(async i => makeFolder(path.join(dirname, i[0]), i[0])));
		folder.entries = files.filter(i => i[1] == vscode.FileType.File).map(i => makeFileEntry(path.join(dirname, i[0])));
		return folder;
	});
}

export class AndroidProject extends MsBuildProjectBase {
	projectDir = '';

	async postload(props: MsBuild.PropertyContext) {
		await super.postload(props);
		const gradle 	= this.msbuild.items.GradlePackage;//.getDefinition('ProjectDirectory');
		const result 	= await gradle.evaluate(new MsBuild.PropertyContext);
		this.projectDir = path.join(path.dirname(this.fullpath), result[0].ProjectDirectory);
	}

	public getFolders(view: string) : Promise<FolderTree> {
		return this.ready.then(async() => {
			const	foldertree = new FolderTree;
			foldertree.root.addFolder(await makeFolder(this.projectDir, 'Project'));
			return foldertree;
		});
	}
}

export class ESProject extends MsBuildProjectBase {
	folders: Promise<FolderTree>;

	constructor(parent:any, type:string, name:string, fullpath: string, guid: string, solution_dir: string) {
		super(type, name, fullpath, guid, solution_dir);
		this.folders = makeFolder(path.dirname(this.fullpath), '').then(root => new FolderTree(root));
	}
	public async getFolders(view: string) : Promise<FolderTree> {
		return this.folders;
	}
}
