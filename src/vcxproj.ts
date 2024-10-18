import * as vscode from 'vscode';
import * as path from "path";
import * as xml from "./modules/xml";
import * as fs from './modules/fs';
import * as MsBuild from './MsBuild';
import {MsBuildProject} from './MsBuildProject';
import {ProjectItemEntry, Folder, FolderTree} from "./Project";
import {XMLCache, xml_save} from './extension';

//-----------------------------------------------------------------------------
//	Filters
//-----------------------------------------------------------------------------

async function loadFilterTree(fullPath : string, allfiles: Record<string, ProjectItemEntry>): Promise<FolderTree|undefined> {
	const basePath		= path.dirname(fullPath);
	const content		= await fs.loadTextFile(fullPath);
	const document		= xml.parse(content);
	const filtertree	= new FolderTree;
	const project		= document?.firstElement();
	const extensions: Record<string, Folder> = {};

	if (project?.name == 'Project') {
		for (const element of project.children) {
			if (xml.isElement(element) && element.name === 'ItemGroup') {
				for (const item of element.children) {
					if (xml.isElement(item) && item.attributes.Include) {
						if (item.name === "Filter") {
							const folder 	= filtertree.addDirectory(item.attributes.Include);
							const exts		= item.elements.Extensions?.firstText();
							if (exts) {
								for (const e of exts.split(';'))
									extensions[e] = folder;
							}

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
	for (const i in allfiles) {
		const ext = path.extname(i).slice(1);
		const f = extensions[ext] ?? filtertree.root;
		f.add(allfiles[i]);
	}

	return filtertree;
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

	return xml_save(filename, element);
}


export class VCProject extends MsBuildProject {
	private filtertree: Promise<FolderTree | undefined>;
	private filter_dirty	= 0;

	constructor(parent:any, type:string, name:string, fullpath: string, guid: string, solution_dir: string) {
		super(parent, type, name, fullpath, guid, solution_dir);

		const filterpath	= this.fullpath + ".filters";
		this.filtertree		= this.loadFilters(filterpath);
		fs.onChange(filterpath, (path: string) => {
			console.log("Filter changed");
			this.filtertree = this.loadFilters(path);
		});
	}

	public async getFolders(view:string) : Promise<FolderTree> {
		return (view === 'filter' && await this.filtertree) || super.getFolders(view);
	}

	private async loadFilters(fullPath : string): Promise<FolderTree|undefined> {
		return this.ready.then(() => {
			const allfiles : Record<string, ProjectItemEntry> = {};
			for (const i of Object.values(this.msbuild.items)) {
				if (i.mode === MsBuild.ItemMode.File) {
					//if (i.definitions.length)
						for (const entry of i.entries)
							allfiles[entry.data.fullPath] = entry;
				}
			}
			return loadFilterTree(fullPath, allfiles);
		});
	}

	public dirtyFilters() {
		++this.filter_dirty;
	}

	public async clean() {
		const promises = [super.clean()];
		if (this.filter_dirty) {
			const tree = await this.filtertree;
			if (tree)
				promises.push(saveFilterTree(tree, this.fullpath + ".filters"));
			this.filter_dirty = 0;
		}

		await Promise.all(promises);
	}

	public renameFolder(folder: Folder, newname: string) : boolean {
		folder.name = newname;
		this.dirtyFilters();
		return true;
	}
	public addFile(name: string, filepath: string): boolean {
		this.msbuild.ext_assoc.value.then(ext_assoc => {
			const ext = path.extname(name);
			const ContentType = ext_assoc[ext];
			if (ContentType) {
				const item = this.msbuild.items[ContentType];
				item.includeFile(path.dirname(this.fullpath), filepath);
				this.dirty();
			}
		});
		return false;
	}

	public async debug(settings: Record<string, string>) {
		const [props, _] = await this.evaluateProps(settings);
		return {
			type: 'cppvsdbg',
			program: props.properties.TARGETPATH,
			args: [],
		};
	}
}
