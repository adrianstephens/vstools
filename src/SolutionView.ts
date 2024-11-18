import * as vscode from "vscode";
import * as path from "path";
import * as fs from "./vscode-utils/fs";
import * as nuget from './nuget';
import * as utils from "./shared/utils";

import * as MsBuild from "./MsBuild";
import * as SettingsView from "./SettingsView";

import {Extension, searchOption, SubMenu, hierarchicalMenu, yesno} from "./extension";
import {Solution, getProjectIconName} from "./Solution";
import {Project, Folder, FolderTree, ProjectItemEntry, makeFileEntry} from "./Project";
import {MsBuildProjectBase} from "./MsBuildProject";
import {VCProject} from './vcxproj';
import {templates, Template} from "./Templates";

const TreeItemCollapsibleState = vscode.TreeItemCollapsibleState;
type Uri = vscode.Uri;


class TreeItemHighlight implements vscode.TreeItemLabel {
	highlights?: [number, number][];
	constructor(public label: string) {
		this.label = label;
		this.highlights = [[0,label.length]];
	}
}

export abstract class TreeItem extends vscode.TreeItem {
	public children: TreeItem[] | null = null;

	constructor(
		public parent: TreeItem | null,
		label: string | vscode.TreeItemLabel,
		collapsibleState = TreeItemCollapsibleState.None,
		path?: string,
	) {
		super(label, collapsibleState);
		if (path)
			this.resourceUri = vscode.Uri.file(path);
	}

	public get label_text() {
		return typeof(this.label) == 'string' ? this.label : this.label?.label;
	}

	public clearChildren(): void {
		if (this.children)
			this.children.forEach(c => c.clearChildren());
		this.children = null;
	}

	public createChildren(): Promise<TreeItem[]> {
		return Promise.resolve([]);
	}

	public findByUri(uri: Uri, type?: string): TreeItem | undefined{
		if (this.children) {
			for (const i of this.children) {
				const i2 = i.findByUri(uri, type);
				if (i2) {
					if (type && this.contextValue === type)
						return this;
					return i2;
				}
			}
		} else if (this.resourceUri?.fsPath == uri.fsPath) {
			return this;
		}
	}

	public highlight(highlight:boolean): boolean {
		const highlit = this.label instanceof TreeItemHighlight;
		if (highlight != highlit) {
			this.label = highlight ? new TreeItemHighlight(this.label as string) : (this.label as TreeItemHighlight).label;
			return true;
		}
		return false;
	}
}

class FileTreeItem extends TreeItem {
	constructor(parent: TreeItem, fullPath: string) {
		super(parent, path.basename(fullPath), TreeItemCollapsibleState.None, fullPath);
		this.contextValue = 'file';
		this.command = {title: 'open', command: 'vstools.select_open', arguments: [this] };
	}
}

class FileEntryTreeItem extends FileTreeItem {
	constructor(parent: TreeItem, public entry: ProjectItemEntry) {
		super(parent, entry.data.fullPath);
	}
}

function createFolders(parent: TreeItem, folder: Folder, foldericon: any) {
	const children: TreeItem[] = folder.folders.sort((a, b) => utils.compare(a.name, b.name)).map(i => new FolderTreeItem(parent, i, foldericon));
	for (const i of folder.entries.sort((a, b) => utils.compare(a.name, b.name))) {
		const item = new FileEntryTreeItem(parent, i);
		if (MsBuild.hasMetadata(i) && i.value('ExcludedFromBuild'))
			item.iconPath = new vscode.ThemeIcon("error");
		children.push(item);
	}
	return children;
}

class FolderTreeItem extends TreeItem {
	constructor(parent: TreeItem, public folder: Folder, foldericon: any) {
		super(parent, folder.name, TreeItemCollapsibleState.Collapsed);
		this.iconPath = foldericon;
		this.contextValue = 'folder';
	}
	createChildren(): Promise<TreeItem[]> {
		return Promise.resolve(createFolders(this, this.folder, this.iconPath));
	}
}

class ImportsGroupTreeItem extends TreeItem {
	constructor(parent: TreeItem, label:string, public imports: string[]) {
		super(parent, label, TreeItemCollapsibleState.Collapsed);
		this.iconPath = Extension.getIcon('PropertiesFolderClosed');
	}
	createChildren(): Promise<TreeItem[]> {
		return Promise.resolve(this.imports.map(i => new FileTreeItem(this, i)));
	}
}
class ImportsTreeItem extends TreeItem {
	constructor(parent: TreeItem, public project: MsBuildProjectBase) {
		super(parent, "imports", TreeItemCollapsibleState.Collapsed);
		this.iconPath = Extension.getIcon('PropertiesFolderClosed');
	}
	createChildren(): Promise<TreeItem[]> {
		const children: TreeItem[] = [];
		for (const i in this.project.msbuild.imports) {
			if (i != 'all')
				children.push(new ImportsGroupTreeItem(this, i || 'other', this.project.msbuild.imports[i]));
		}
		return Promise.resolve(children);
	}
}

class PackageTreeItem extends TreeItem {
	constructor(parent: TreeItem, name: string) {
		super(parent, name, TreeItemCollapsibleState.None);
	}
}

class PackagesTreeItem extends TreeItem {
	constructor(parent: TreeItem, public project: MsBuildProjectBase) {
		super(parent, "packages", TreeItemCollapsibleState.Collapsed);
		this.iconPath = Extension.getIcon('ReferenceFolderClosed');
	}
	createChildren(): Promise<TreeItem[]> {
		return Promise.resolve(this.project.msbuild.items.PackageReference.entries.map(i => new PackageTreeItem(this, i.name)));
	}
}

class DependencyTreeItem extends TreeItem {
	constructor(parent: TreeItem, project: Project) {
		super(parent, path.basename(project.name), TreeItemCollapsibleState.None, project.fullpath);
	}
}

class DependenciesTreeItem extends TreeItem {
	constructor(parent: TreeItem, public project: Project) {
		super(parent, "references", TreeItemCollapsibleState.Collapsed);
		this.iconPath = Extension.getIcon('ReferenceFolderClosed');
	}
	createChildren(): Promise<TreeItem[]> {
		return Promise.resolve(this.project.dependencies.map(i => new DependencyTreeItem(this, i)));
	}
}
/*
class ItemGroupTreeItem extends TreeItem {
	constructor(parent: TreeItem, label: string, public items: Items) {
		super(parent, label, TreeItemCollapsibleState.Collapsed);
		this.iconPath = Extension.getIcon('FolderClosed');//vscode.ThemeIcon.Folder;
		this.contextValue = 'items';//items.schema ? 'items' : 'items_noschema';
	}
	createChildren(): Promise<TreeItem[]> {
		const children: TreeItem[] = [];
		for (const i of this.items.entries) {
			if (i.data.fullPath)
				children.push(new FileEntryTreeItem(this, i));
		}
		return Promise.resolve(children);
	}
}
*/
class ProjectTreeItem extends TreeItem {
	public view_by: string = 'filter';

	constructor(private provider: SolutionExplorerProvider, parent: TreeItem, public project: Project, startup: boolean = false) {
		const name = path.basename(project.name);
		super(parent, startup ? new TreeItemHighlight(name) : name, TreeItemCollapsibleState.Collapsed, project.fullpath);

		const iconname = getProjectIconName(this.project.type);
		if (iconname)
			this.iconPath = Extension.getIcon(iconname);
			this.contextValue = 'solution-folder';

		if (this.project instanceof MsBuildProjectBase) {
			this.command = {title: 'select', command: 'vstools.select', arguments: [this] };
			this.contextValue = 'project';
			fs.onChange(project.fullpath + ".filters", (path:string) => {
				provider.recreate(this);
			});
		}
		project.onDidChange(() => {
			provider.recreate(this);
		});

	}

	async createChildren(): Promise<TreeItem[]> {
		return this.project.ready.then(async () => {
			let children: TreeItem[] = [];

			if (this.project.dependencies.length)
				children.push(new DependenciesTreeItem(this, this.project));

			if (this.project instanceof MsBuildProjectBase && ('PackageReference' in this.project.msbuild.items))
				children.push(new PackagesTreeItem(this, this.project));

			for (const i of this.project.childProjects)
				children.push(new ProjectTreeItem(this.provider, this, i));
			
			if (this.project instanceof MsBuildProjectBase && Object.keys(this.project.msbuild.imports).length)
				children.push(new ImportsTreeItem(this, this.project));

			const tree = await this.project.getFolders(this.view_by);
			const icons: Record<string,any> = {
				'filter':	Extension.getIcon('FilterFolderClosed'),
				'folder':	Extension.getIcon('FolderClosed'),
				'items':	Extension.getIcon('PropertiesFolderClosed'),
			};
			children = children.concat(createFolders(this, tree.root, icons[this.view_by]));

			return children;
		});
	}
}

class ConfigTreeItem extends TreeItem {
	constructor(parent: TreeItem, label: string, public index: number) {
		super(parent, label);
		this.command = {title: 'select', command: 'vstools.setConfig', arguments: [this] };
	}
}
class ConfigsTreeItem extends TreeItem {
	constructor(parent: TreeItem, public solution: Solution) {
		super(parent, "configuration: " + solution.activeConfiguration.Configuration, TreeItemCollapsibleState.Collapsed);
		this.iconPath	= new vscode.ThemeIcon("star");
		//this.id			= 'configuration';
	}
	createChildren(): Promise<TreeItem[]> {
		return Promise.resolve(this.solution.configurationList().map((v, i) => new ConfigTreeItem(this, v, i)));
	}
}

class PlatformTreeItem extends TreeItem {
	constructor(parent: TreeItem, label: string, public index: number) {
		super(parent, label);
		this.command = {title: 'select', command: 'vstools.setPlatform', arguments: [this] };
	}
}
class PlatformsTreeItem extends TreeItem {
	constructor(parent: TreeItem, public solution: Solution) {
		super(parent, "platform: " + solution.activeConfiguration.Platform, TreeItemCollapsibleState.Collapsed);
		this.iconPath 	= new vscode.ThemeIcon("star");
		//this.id			= 'platform';
	}
	createChildren(): Promise<TreeItem[]> {
		return Promise.resolve(this.solution.platformList().map((v, i) => new PlatformTreeItem(this, v, i)));
	}
}

function project_compare(a: Project, b: Project) {
	const am = a instanceof MsBuildProjectBase;
	const bm = b instanceof MsBuildProjectBase;
	return am != bm
		? (am ? 1 : -1)
		: utils.compare(a.name, b.name);
}

class SolutionTreeItem extends TreeItem {
	constructor(private provider: SolutionExplorerProvider, public solution: Solution) {
		super(null, path.basename(solution.fullpath), TreeItemCollapsibleState.Expanded, solution.fullpath);
		this.contextValue = 'solution';
		this.command = {title: 'select', command: 'vstools.select', arguments: [this] };
		solution.onDidChange(what => {
			switch (what) {
				case 'startup':
					for (const i of this.children || []) {
						if ((i instanceof ProjectTreeItem) && i.highlight(i.project == this.solution.startup))
							provider.refresh(i);
					}
					break;
				case 'change':
					provider.recreate(this);
					break;
				case 'remove':
					provider.removeSolution(this.solution);
					break;
			}
		});
	}

	createChildren(): Promise<TreeItem[]> {
		const children: TreeItem[] = [];
		children.push(new ConfigsTreeItem(this, this.solution));
		children.push(new PlatformsTreeItem(this, this.solution));

		for (const project of this.solution.childProjects.sort((a, b) => project_compare(a, b)))
			children.push(new ProjectTreeItem(this.provider, this, project, project === this.solution.startup));
/*
		for (const id of Object.keys(this.solution.projects).sort((a, b) => project_compare(this.solution.projects[a], this.solution.projects[b]))) {
			const project = this.solution.projects[id];
			if (project.parent === this.solution)
				children.push(new ProjectTreeItem(this.provider, this, project, project === this.solution.startup));
		}
			*/
		return Promise.resolve(children);
	}
}

const SOLUTION_EXPLORER_MIME_TYPE = 'application/vnd.code.tree.solutionExplorer';
const URI_LIST_MIME_TYPE = 'text/uri-list';

class DataTransferItem extends vscode.DataTransferItem {
	constructor(public items: TreeItem[]) {
		super(items);
	}
	asString(): Thenable<string> { return Promise.resolve(""); }
	asFile(): vscode.DataTransferFile | undefined { return undefined; }
}

async function getFolder(item: TreeItem): Promise<Folder | undefined> {
	return item && item instanceof FolderTreeItem ? item.folder
		: item && item instanceof ProjectTreeItem && item.project instanceof MsBuildProjectBase ? (await item.project.getFolders('filter'))?.root
		: undefined;
}

function addFile(fullPath: string, dest: Folder, filters?: FolderTree) {
	const found = filters?.findFile(fullPath);
	if (found) {
		found[0].remove(found[1]);
		dest.add(found[1]);
	} else {
		dest.add(makeFileEntry(fullPath));
	}
}

interface TemplateItem extends vscode.QuickPickItem {
	template?: Template;
}

function menuGroup(label: string, group?: Template[]): TemplateItem[] {
	return group && group.length ? [
		{label, kind: vscode.QuickPickItemKind.Separator},
		...group.sort((a, b) => utils.compare(a.name, b.name)).map(t => ({label: t.name, template: t})),
	] : [];
}

function menuTagGroup(label:string, baseTitle: string, group: Template[], tags: Set<string>): SubMenu<TemplateItem> {
	let title;
	if (tags.size) {
		const keys = Array.from(tags.keys());
		const last = keys.pop();
		title = `${baseTitle} tagged with ${keys.join(', ')}${keys.length ? ' and ' : ''}${last}`;
	} else {
		title = baseTitle;
	}
	return {label, title, get children() { return menuTagGroupChildren(baseTitle, group, tags); } };
}

function menuTagGroupChildren(baseTitle: string, group: Template[], tags: Set<string>): (TemplateItem|SubMenu<TemplateItem>)[] {
	const byTag: Record<string, Template[]> = {};
	group.forEach(t => t.tags.forEach(i => {
		if (!tags.has(i))
			(byTag[i] ??= []).push(t);
	}));
	return [
		{label: "By Tag", kind: vscode.QuickPickItemKind.Separator},
		...Object.keys(byTag).map(i => menuTagGroup(i, baseTitle, byTag[i], new Set([...tags, i]))),
		...Object.entries(utils.partition(group, t => t.language)).map(([i, group]) => menuGroup(i, group)).flat(),
	];
}


export class SolutionExplorerProvider implements vscode.TreeDataProvider<TreeItem>, vscode.TreeDragAndDropController<TreeItem> {//, vscode.FileDecorationProvider {
	private solutions: 		Solution[]	= [];
	private treeView: 		vscode.TreeView<TreeItem>;
	private children: 		TreeItem[]	= [];
	public	dropMimeTypes:	string[]	= [SOLUTION_EXPLORER_MIME_TYPE, URI_LIST_MIME_TYPE];
	public	dragMimeTypes:	string[]	= [URI_LIST_MIME_TYPE];

	private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private _onDidChangeFileDecorations = new vscode.EventEmitter<Uri>();
	readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

	public refresh(node?: TreeItem): void {
		this._onDidChangeTreeData.fire(node);
	}
	public recreate(node?: TreeItem): void {
		if (node) {
			node.clearChildren();
		} else {
			this.children.forEach(c => c.clearChildren());
			this.children = [];
		}
		this._onDidChangeTreeData.fire(node);
	}

	public getTreeItem(element: TreeItem): vscode.TreeItem {
		return element;
	}

	public getRootByContext(element: TreeItem, type: string) {
		let i: TreeItem | null = element;
		while (i && !(i.contextValue != type))
			i = i.parent;
		return i;
	}

	public getRootByClass(element: TreeItem, type: any) {
		let i: TreeItem | null = element;
		while (i && !(i instanceof type))
			i = i.parent;
		return i;
	}

	public getProject(item: TreeItem) {
		return (this.getRootByClass(item, ProjectTreeItem) as ProjectTreeItem)?.project;
	}

	public getSolution(item: TreeItem) {
		return (this.getRootByClass(item, SolutionTreeItem) as SolutionTreeItem)?.solution;
	}

	public getChildren(element?: TreeItem) {//}: Promise<TreeItem[]> | undefined {
		if (element) {
			if (!element.children) {
				return element.createChildren().then(children => {
					return element.children = children;
				}).catch(err => {
					console.log(`get children: ${element.label} err=${err}`);
					return element.children = [];
				});
			}
			return Promise.resolve(element.children);
		}

		if (!this.children.length)
			this.solutions.forEach(solution => this.children.push(new SolutionTreeItem(this, solution)));
		return Promise.resolve(this.children);
	}

	public getParent(element: TreeItem): TreeItem | null {
		return element.parent;
	}

	public getSelectedItems(): readonly TreeItem[] | undefined {
		return this.treeView.selection;
	}

	public findByUri(uri: Uri, type?: string): TreeItem | undefined {
		if (!type) {
			//use item in selection if found
			const result = this.treeView.selection.find(i => i.resourceUri?.fsPath == uri.fsPath);
			if (result)
				return result;
		}

		for (const i of this.children) {
			const result = i.findByUri(uri, type);
			if (result)
				return result;
		}
	}

	public async findCreate(node: TreeItem, uri: Uri): Promise<TreeItem|null> {
		if	(node.resourceUri?.fsPath === uri.fsPath)
			return node;

		const children = await this.getChildren(node);
		return children.length
			? Promise.any(children.map(child => this.findCreate(child, uri).then(result => result??Promise.reject()))).catch(()=>null)
			: null;
	}

	private setView(item: ProjectTreeItem, view_by: string) {
		item.view_by = view_by;
		this.recreate(item);
		this.treeView.reveal(item, {expand: true});
	}

	public addSolution(solution: Solution) {
		this.solutions.push(solution);
		this.recreate();
	}
	public removeSolution(solution: Solution) {
		if (utils.array_remove(this.solutions, solution))
			this.recreate();
	}

	constructor() {
		const has: any = {
			hasOpen: 		["file", "project", "solution"],
			hasCut: 		["file", "multi"],
			hasCopy: 		["file", "multi"],
			hasPaste: 		["folder"],
			hasDelete: 		["file", "folder", "project", "multi"],
			hasRename: 		["folder"],
			hasAddFile: 	["folder", "project", "solution-folder"],
			hasCreateFile: 	["folder", "project", "solution-folder"],
			hasCreateFolder:["folder", "project", "solution", "solution-folder"],
			hasSettings: 	["file", "project", "items", "solution"],
			hasBuild: 		["project", "solution"],
		};

		for (const key in has)
			vscode.commands.executeCommand('setContext', 'vstools.' + key, has[key]);

		const options = {
			treeDataProvider: this,
			dragAndDropController: this,
			canSelectMany: true,
			showCollapseAll: true
		};

		this.treeView = vscode.window.createTreeView('vstools-view', options);

		this.treeView.onDidChangeSelection(ev => {
			let contextValue: string | undefined;
			if (ev.selection.length === 1) {
				const sel = ev.selection[0];
				contextValue = sel.contextValue;
				if (contextValue === 'file') {
					const proj = this.getRootByClass(sel, ProjectTreeItem) 		as ProjectTreeItem;
					Extension.current = {project: proj.project, solution: this.getSolution(proj)};
				}
			} else {
				contextValue = 'multi';
			}
			vscode.commands.executeCommand('setContext', 'vstools.selected', contextValue);
		});

		vscode.window.onDidChangeActiveTextEditor(() => {
			if (vscode.window.activeTextEditor && !SettingsView.exists()) {
				const item = this.treeView.selection[0].resourceUri?.fsPath === vscode.window.activeTextEditor.document.uri.fsPath
					? this.treeView.selection[0]
					: this.findByUri(vscode.window.activeTextEditor.document.uri, 'file');
				if (item)
					this.treeView.reveal(item);
			}
		});

		//vscode.window.registerFileDecorationProvider(this);

		//------------------------
		// tree commands
		//------------------------

		Extension.registerCommand('vstools.open', async (item: TreeItem) => {
			if (item.resourceUri)
				vscode.commands.executeCommand('vscode.open', item.resourceUri);
		});
		Extension.registerCommand('vstools.select', async (item: TreeItem) => {
			if (SettingsView.exists())
				this.updateSettings(item);
		});
		Extension.registerCommand('vstools.select_open', async (item: TreeItem) => {
			if (SettingsView.exists() && has.hasSettings.indexOf(item.contextValue) !== -1) {
				this.updateSettings(item);
			} else if (item.resourceUri) {
				vscode.commands.executeCommand('vscode.open', item.resourceUri);
			}
		});

		Extension.registerCommand('vstools.setConfig', async (item: ConfigTreeItem) => {
			const parent	= item.parent as ConfigsTreeItem;
			const solution	= this.getSolution(parent);
			solution.active[0] = item.index;
			parent.label = "configuration: " + solution.activeConfiguration.Configuration;
			this.recreate(parent);
		});
		Extension.registerCommand('vstools.setPlatform', async (item: PlatformTreeItem) => {
			const parent	= item.parent as PlatformsTreeItem;
			const solution	= this.getSolution(parent);
			solution.active[1] = item.index;
			parent.label = "platform: " + solution.activeConfiguration.Platform;
			this.recreate(parent);
		});

		Extension.registerCommand('vstools.cut', async () =>
			vscode.env.clipboard.writeText(this.treeView.selection.filter(i => !!i.resourceUri).map(i => `<cut:${this.getProject(i).name}>` + i.resourceUri?.fsPath).join('\n'))
		);
		
		Extension.registerCommand('vstools.copy', async () =>
			vscode.env.clipboard.writeText(this.treeView.selection.filter(i => !!i.resourceUri).map(i => i.resourceUri?.fsPath).join('\n'))
		);

		Extension.registerCommand('vstools.paste', async (item?: TreeItem) => {
			if (!item)
				item = this.treeView.selection[0];

			const folder = await getFolder(item);
			if (folder) {
				const project = this.getProject(item);
				const filters = project instanceof MsBuildProjectBase ? await project.getFolders('filter') : undefined;
				for (let file of (await vscode.env.clipboard.readText()).split('\n')) {
					const cut = file.startsWith('<cut:');
					if (cut)
						file = file.substring(file.indexOf('>') + 1);
					const filepath = path.resolve(vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? '', file);
					const stat = await fs.getStat(filepath);
					if (stat && stat.type !== vscode.FileType.Directory)
						addFile(filepath, folder, filters);
				}
				this.recreate(item);
				if (project instanceof VCProject)
					project.dirtyFilters();
			}
		});

		Extension.registerCommand('vstools.delete', async (item?: TreeItem) => {
			if (!item)
				item = this.treeView.selection[0];

			if (item instanceof TreeItem && item.parent) {
				if (item instanceof ProjectTreeItem) {
					const solution	= this.getSolution(item);
					if (await yesno(`Are you sure you want to remove ${item.project.name} from ${solution.fullpath}?`)) {
						solution.removeProject(item.project);
						this.recreate(item.parent);
					}

				} else {
					const project 	= this.getProject(item);
					const folder = await getFolder(item.parent);
					if (item instanceof FolderTreeItem) {
						if (project.removeFolder(item.folder))
							folder?.removeFolder(item.folder);
					} else if (item instanceof FileEntryTreeItem) {
						if (project.removeEntry(item.entry))
							folder?.remove(item.entry);
					}
	
					this.recreate(item.parent);
				}

			}
		});

		Extension.registerCommand('vstools.rename', async (item?: TreeItem) => {
			if (!item)
				item = this.treeView.selection[0];
			if (item instanceof TreeItem) {
				const newName = await vscode.window.showInputBox({
					value: item.label as string,
					prompt: 'Enter the new name',
				});
				if (newName) {
					if (item instanceof FolderTreeItem) {
						const project 	= this.getProject(item);
						if (!project.renameFolder(item.folder, newName))
							return;
					}
					item.label = newName;
					this.refresh(item);
				}
			}
		});
		Extension.registerCommand('vstools.addFile', async (item?: TreeItem) => {
			if (!item)
				item = this.treeView.selection[0];
			const options: vscode.OpenDialogOptions = {
				filters: {
					'All Files': ['*']
				}
			};
			const file = (await vscode.window.showOpenDialog(options))?.[0].fsPath;
			if (file) {
				const project 	= this.getProject(item);
				if (project.addFile(path.basename(file), file)) {
					const folder = await getFolder(item);
					if (folder)
						addFile(file, folder);
					this.recreate(item);
				}
			}
		});

		Extension.registerCommand('vstools.newFolder', async (item?: TreeItem) => {
			if (!item)
				item = this.treeView.selection[0];
			
			this.treeView.reveal(item, {expand: 1});
			const newName = await vscode.window.showInputBox({
				value: '',
				prompt: 'Enter the new folder name',
			});
			if (newName) {
				const folder = await getFolder(item);
				folder?.addFolder(new Folder(newName));
				this.recreate(item);

				const project 	= this.getProject(item);
				if (project instanceof VCProject)
					project.dirtyFilters();
			}
		});

		Extension.registerCommand('vstools.addProject', async (item?: SolutionTreeItem) => {
			const solution = item ? item.solution : this.solutions[0];
			const options: vscode.OpenDialogOptions = {
				filters: {
					'All Project Files':					['csproj', 'fsproj', 'vbproj', 'shproj', 'wapproj', 'vcxproj', 'vcproj', 'vcxitems', 'xproj', 'esproj', 'androidproj', 'msbuildproj'],
					'C# Project Files': 					['csproj'],
					'F# Project Files': 					['fsproj'],
					'VB Project Files': 					['vbproj'],
					'Shared Projects':  					['shproj'],
					'WAPProj Project Files': 				['wapproj'],
					'VC++ Project Files':   				['vcxproj', 'vcxitems'],
					'.NET Core 2015 Project Files': 		['xproj'],
					'Javascript Application Project Files':	['esproj'],
					'Android Packaging Projects':  			['androidproj'],
					'Common Project System Files':			['msbuildproj'],
				}
			};
			const file = (await vscode.window.showOpenDialog(options))?.[0].fsPath;
			if (file)
				solution.addProjectFilename(file);
		});

		Extension.registerCommand('vstools.newFile', async (item: TreeItem) => {
			const project			= this.getProject(item);
			const all_templates 	= await templates.value;
			const item_templates 	= [...all_templates.Item, ...all_templates.DotNetItem];
			const menu	= menuTagGroupChildren('Pick an Item Template', item_templates, new Set<string>);

			const x 	= await hierarchicalMenu<TemplateItem>(menu, 'Select an Item Type');
			if (!x)
				return;

			const template	= x.template!;
			const folder	= path.dirname(project.fullpath);
			const name0 	= path.basename(await fs.createNewName(path.join(folder, template.defaultName)), path.extname(template.defaultName));
			const name		= await vscode.window.showInputBox({value: name0, prompt: 'Enter the new Project name'});
			if (!name)
				return;

			template.create(folder, name, {
				addFile(filename: string) {
					project.addFile(path.basename(filename), filename);
				}
			});
		});

		Extension.registerCommand('vstools.newProject', async (item?: SolutionTreeItem) => {
			const solution		= item ? item.solution : this.solutions[0];
			const all_templates = await templates.value;
			const project_templates = [...all_templates.Project, ...all_templates.ProjectGroup, ...all_templates.DotNetProject];

			const menu	= [
				{label: "By Language", kind: vscode.QuickPickItemKind.Separator},
				...Object.entries(utils.partition(project_templates, t => t.language)).map(([i, group]) => {
					const title  = `Pick a ${i} Project Template`;
					return {label: i, title, children: menuTagGroupChildren(title, group, new Set<string>)};
				}),
				...menuTagGroupChildren('Pick a Project Template', project_templates, new Set<string>)
			];

			const x 	= await hierarchicalMenu<TemplateItem>(menu, 'Select a Project Type');
			if (!x)
				return;

			const folder	= await vscode.window.showOpenDialog({
				defaultUri: 		vscode.workspace.workspaceFolders?.[0].uri,
				canSelectFolders:	true,
				openLabel: 			'Select Folder'
			});
			
			if (folder && folder.length) {
				const template	= x.template!;
				const name0 	= path.basename(await fs.createNewName(path.join(folder[0].fsPath, template.defaultName)));
				const name		= await vscode.window.showInputBox({value: name0, prompt: 'Enter the new Project name'});
				if (!name)
					return;

				template.create(path.join(folder[0].fsPath, name), name, {
					addFile(filename: string) {
						solution.addProjectFilename(filename);
					}
				});
			}
		});

		Extension.registerCommand('vstools.refresh', (item?: TreeItem) => this.recreate(item));

		Extension.registerCommand('vstools.settings', (item: TreeItem) => this.updateSettings(item));

		Extension.registerCommand('vstools.projectStartup', (item: ProjectTreeItem) => {
			const solution = this.getSolution(item);
			solution.startup = item.project;
		});

		Extension.registerCommand('vstools.build', (item: TreeItem) => {
			const project 	= this.getProject(item);
			const solution	= this.getSolution(item);
			const settings: Record<string, string> = {
				...solution?.activeConfiguration,
				VisualStudioVersion:	"17.0"
			};

			if (project) {
				settings.file = solution.fullpath;
				project.build(settings);
			} else {
				solution.build(settings);
			}
		});

		Extension.registerCommand('vstools.projectViewByFilter',	item => this.setView(item, "filter"));
		Extension.registerCommand('vstools.projectViewByFolder', 	item => this.setView(item, "folder"));
		Extension.registerCommand('vstools.projectViewByItem', 		item => this.setView(item, "items"));

		Extension.registerCommand('vstools.addPackage', 			async (item: ProjectTreeItem) => {
			const project = item.project as MsBuildProjectBase;

			const feeds = await project.nugetFeeds();
			let feed = feeds[0];
			if (feeds.length > 1) {
				const x = await vscode.window.showQuickPick((await project.nugetFeeds()).map(f => ({label: f.name, feed: f})), {placeHolder: 'Select a feed'});
				if (!x)
					return;
				feed = x.feed;
			}

			const search = await searchOption('Title', 'Search a package', '', async search => (await nuget.searchPackage(feed, search)).map(p => ({label: p.id, package: p})));
			if (!search)
				return;

			const version = await vscode.window.showQuickPick(search.package.versions.map(v => ({label: v.version, version: v})), {placeHolder: 'Select a version'});
			if (!version)
				return;

			project.msbuild.items.PackageReference.includePlain(search.package.id, version.version);
			
		});

		Extension.registerCommand("vstools.findInSolution",		async (uri: Uri) => {
			const project = await Promise.any(
				this.solutions.map(async solution => await Promise.any(Object.values(solution.projects)
					.map(project => project.getFolders('filter').then(tree => tree.findFile(uri.fsPath) ? project : Promise.reject()))
				))).catch(() => null);

			for (const i of await this.getChildren((await this.getChildren())[0])) {
				if (i instanceof ProjectTreeItem && i.project === project) {
					const found = await this.findCreate(i, uri);
					if (found) {
						this.treeView.reveal(found);
					}
					break;
				}
			}
		});

	}

	public updateSettings(item: TreeItem) {
		const solution = this.getSolution(item);
		if (item.contextValue == 'solution') {
			SettingsView.Set("Solution Settings", solution.activeConfiguration, solution);
			return;
		}
		const project 	= this.getProject(item);
		if (project instanceof MsBuildProjectBase) {
			project.ready.then(async () => {
				const c = project.configuration[solution.active.join('|')];
				const config = {
					Configuration:	c?.Configuration ?? solution.active[0],
					Platform: 		c?.Platform ?? solution.active[1],
				};

				switch (item.contextValue) {
					case "project": {
						SettingsView.Set(`${project.name} Project Settings`, config, project);
						break;
					}
					//case "items": {
					//	const schemas: xml.Element[] = [];
					//	const values: any[] = [];
					//	for (const i of project.schemas) {
					//		schemas.push(i);
					//		values.push([]);
					//	}
					//	if (schemas.length)
					//		SettingsView.Set(`${item.label as string} Item Settings`, schemas, values, project.configuration);
					//	break;
					//}
					case "file": {
						const fullpath = item.resourceUri?.fsPath || '';
						SettingsView.Set(`${item.label as string} Settings`, config, project, fullpath);
						break;
					}
				}
			});
		}
	}

	//TreeDragAndDropController
	public handleDrag(sources: TreeItem[], treeDataTransfer: vscode.DataTransfer, token: vscode.CancellationToken) {
		treeDataTransfer.set(SOLUTION_EXPLORER_MIME_TYPE, new DataTransferItem(sources));

		const files = sources.filter(i => i.contextValue === "file");
		if (files.length)
			treeDataTransfer.set('text/uri-list', new vscode.DataTransferItem(files.map(i => i.resourceUri?.toString()).join(';')));
	}

	public async handleDrop(target: TreeItem | undefined, sources: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
		if (target && !token.isCancellationRequested) {
			if (target.contextValue == 'file' && target.parent)
				target = target.parent;
			
			const folder = await getFolder(target);
			if (folder) {
				const project	= this.getRootByClass(target, ProjectTreeItem);
				const dirty		= new Set<TreeItem>([target]);

				let transfer 	= sources.get(SOLUTION_EXPLORER_MIME_TYPE);
				if (transfer) {
					//dropping from this tree

					const files 	= transfer.value.filter((i: TreeItem) => i instanceof FileEntryTreeItem) as FileEntryTreeItem[];
					const folders 	= transfer.value.filter((i: TreeItem) => i instanceof FolderTreeItem) as FolderTreeItem[];

					for (const i of folders) {
						folder.addFolder(i.folder);
						if (i.parent && this.getRootByClass(i, ProjectTreeItem) === project) {
							await getFolder(i.parent).then(f => f?.removeFolder(i.folder));
							dirty.add(i.parent);
						}
					}
				
					for (const i of files) {
						folder.add(i.entry);
						if (i.parent && this.getRootByClass(i, ProjectTreeItem) === project) {
							await getFolder(i.parent).then(f => f?.remove(i.entry));
							dirty.add(i.parent);
						}
					}

				} else if ((transfer = sources.get(URI_LIST_MIME_TYPE))) {
					//dropping from another tree

					const filters	= project && (project instanceof ProjectTreeItem) && project.project instanceof MsBuildProjectBase
									? await project.project.getFolders('filter') : undefined;
					transfer.value.split(';').forEach((i: string) => addFile(vscode.Uri.parse(i).fsPath, folder, filters));
				}

				dirty.forEach(i => this.recreate(i));
				((project as ProjectTreeItem).project as VCProject).dirtyFilters();

			}
		}
	}

	//provideFileDecoration(uri: Uri, token: vscode.CancellationToken): vscode.ProviderResult<vscode.FileDecoration> {
	//	if (uri.fsPath === this.solution.startupProject?.fullpath) {
	//		return {
	//			badge: '\u2713',
	//			color: new ThemeColor("charts.red"), 
	//			// color: new vscode.ThemeColor("tab.activeBackground"), 
	//			// tooltip: ""
	//		};
	//	}
	//	return null;  // to get rid of the custom fileDecoration
	//}
}

