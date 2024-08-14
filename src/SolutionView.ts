import * as vscode from "vscode";
import * as path from "path";

import {compare} from "./utils";
import {getStat, copyFile, copyDirectory} from "./fs";
import {TreeItemCollapsibleState, Uri, ThemeColor} from "vscode";
import {Extension} from "./extension";
import {Solution, getProjectIconName} from "./Solution";
import {Project, Configuration, SolutionFolder, Folder, FolderTree, ProjectItemEntry, makeFileEntry} from "./Project";
import {MsBuildProject, Items, metadata_value} from "./MsBuildProject";
import * as SettingsView from "./SettingsView";

// Fast, simple and insecure hash function
export function fasthash(str: string): string {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash &= hash; // Convert to 32bit integer
	}
	return new Uint32Array([hash])[0].toString(36);
 }

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
		collapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None,
		path?: string,
	) {
		super(label, collapsibleState);
		//this.id = this.createId();
		if (path)
			this.resourceUri = Uri.file(path);
	}

	public get label_text() {
		return typeof(this.label) == 'string' ? this.label : this.label?.label;
	}

	public collapse(): void {
		if (this.collapsibleState !== TreeItemCollapsibleState.None) {
			if (this.children) 
				this.children.forEach(c => c.collapse());
			this.collapsibleState = TreeItemCollapsibleState.Collapsed;
		}
	}

	public clearChildren(): void {
		if (this.children)
			this.children.forEach(c => c.clearChildren());
		this.children = null;
	}

	public createChildren(): Promise<TreeItem[]> {
		return Promise.resolve([]);
	}

	protected createId(): string {
		let id = fasthash(`${this.label}-${this.resourceUri?.fsPath ?? ''}`);
		if (this.parent)
			id = this.parent.id + '-' + id;
		return id;
	}

	public findByUri(uri : Uri, type?: string) : TreeItem | undefined{
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

	public highlight(highlight:boolean) : boolean {
		const highlit = this.label instanceof TreeItemHighlight;
		if (highlight != highlit) {
			this.label = highlight ? new TreeItemHighlight(this.label as string) : (this.label as TreeItemHighlight).label;
			return true;
		}
		return false;
	}
}

class FileTreeItem extends TreeItem {
    constructor(parent : TreeItem, fullPath: string) {
		super(parent, path.basename(fullPath), TreeItemCollapsibleState.None, fullPath);
		this.contextValue = 'file';
		this.command = {title: 'open', command: 'vstools.open', arguments: [this] };
	}
}

class FileEntryTreeItem extends FileTreeItem {
    constructor(parent : TreeItem, public entry: ProjectItemEntry) {
		super(parent, entry.data.fullPath);
	}
}

function createFolders(parent : TreeItem, folder: Folder, foldericon: any) {
	const children : TreeItem[] = [];
	for (const i of folder.folders.sort((a, b) => compare(a.name, b.name)))
		children.push(new FolderTreeItem(parent, i, foldericon));
	for (const i of folder.entries.sort((a, b) => compare(a.name, b.name))) {
		const item = new FileEntryTreeItem(parent, i);
		if (metadata_value(i, 'ExcludedFromBuild'))
			item.iconPath = new vscode.ThemeIcon("error");
		children.push(item);
	}
	return children;
}

class FolderTreeItem extends TreeItem {
    constructor(parent : TreeItem, public folder: Folder, foldericon: any) {
		super(parent, folder.name, TreeItemCollapsibleState.Collapsed);
		this.iconPath = foldericon;
		this.contextValue = 'folder';
	}
	createChildren(): Promise<TreeItem[]> {
        return Promise.resolve(createFolders(this, this.folder, this.iconPath));
    }
}

class ImportsGroupTreeItem extends TreeItem {
    constructor(parent : TreeItem, label:string, public imports: string[]) {
		super(parent, label, TreeItemCollapsibleState.Collapsed);
		this.iconPath = Extension.getIcon('PropertiesFolderClosed');
	}
	createChildren(): Promise<TreeItem[]> {
		const children : TreeItem[] = [];
		for (const i of this.imports)
			children.push(new FileTreeItem(this, i));
        return Promise.resolve(children);
    }
}
class ImportsTreeItem extends TreeItem {
    constructor(parent : TreeItem, public project: MsBuildProject) {
		super(parent, "imports", TreeItemCollapsibleState.Collapsed);
		this.iconPath = Extension.getIcon('PropertiesFolderClosed');
	}
	createChildren(): Promise<TreeItem[]> {
		const children : TreeItem[] = [];
		for (const i in this.project.imports) {
			if (i != 'all')
				children.push(new ImportsGroupTreeItem(this, i || 'other', this.project.imports[i]));
		}
        return Promise.resolve(children);
    }
}

class DependencyTreeItem extends TreeItem {
    constructor(parent : TreeItem, project: Project) {
		super(parent, path.basename(project.name), TreeItemCollapsibleState.None, project.fullpath);
	}
}

class DependenciesTreeItem extends TreeItem {
    constructor(parent : TreeItem, public dependencies: Project[]) {
		super(parent, "references", TreeItemCollapsibleState.Collapsed);
		this.iconPath = Extension.getIcon('ReferenceFolderClosed');
	}
	createChildren(): Promise<TreeItem[]> {
		const children : TreeItem[] = [];
		for (const i of this.dependencies)
			children.push(new DependencyTreeItem(this, i));
        return Promise.resolve(children);
    }
}

class ItemGroupTreeItem extends TreeItem {
    constructor(parent : TreeItem, label : string, public items: Items) {
		super(parent, label, TreeItemCollapsibleState.Collapsed);
		this.iconPath = Extension.getIcon('FolderClosed');//vscode.ThemeIcon.Folder;
		this.contextValue = 'items';//items.schema ? 'items' : 'items_noschema';
	}
	createChildren(): Promise<TreeItem[]> {
		const children : TreeItem[] = [];
		for (const i of this.items.entries) {
			if (i.data.fullPath)
				children.push(new FileEntryTreeItem(this, i));
		}
        return Promise.resolve(children);
    }
}

class ProjectTreeItem extends TreeItem {
	public view_by : string = 'filter';

    constructor(private provider: SolutionExplorerProvider, parent : TreeItem, public project : Project, startup: boolean = false) {
		const name = path.basename(project.name);
		super(parent, startup ? new TreeItemHighlight(name) : name, TreeItemCollapsibleState.Collapsed, project.fullpath);

		if (project instanceof SolutionFolder) {
			this.iconPath = Extension.getIcon('FolderClosed');//vscode.ThemeIcon.Folder;
		} else if (this.project instanceof MsBuildProject) {
			const iconname = getProjectIconName(this.project.type);
			if (iconname)
				this.iconPath = Extension.getIcon('CPPProjectNode');
			this.contextValue = 'project';
			Extension.onChange(project.fullpath + ".filters", (path:string) => {
				provider.recreate(this);
			});
		}
	}

	createChildren(): Promise<TreeItem[]> {
		return this.project.ready.then(async () => {
			let children : TreeItem[] = [];

			if (this.project.dependencies.length)
				children.push(new DependenciesTreeItem(this, this.project.dependencies));

			const childProjects = this.project.childProjects;
			for (const i in childProjects) {
				const child = childProjects[i];
				children.push(new ProjectTreeItem(this.provider, this, child));
			}
			
			if (this.project instanceof MsBuildProject) {
				const msbuild = this.project as MsBuildProject;
				if (Object.keys(msbuild.imports).length)
					children.push(new ImportsTreeItem(this, msbuild));

				switch (this.view_by) {
					case 'filter': {
						const tree = await msbuild.getFolders(true);
						if (tree)
							children = children.concat(createFolders(this, tree.root, Extension.getIcon('FilterFolderClosed')));
						break;
					}
					case 'folder': {
						const tree = await msbuild.getFolders(false);
						if (tree)
							children = children.concat(createFolders(this, tree.root, Extension.getIcon('FolderClosed')));
						break;
					}
					case 'items':
						for (const i in msbuild.items) {
							if (msbuild.items[i].entries.find(i => i.data.fullPath))
								children.push(new ItemGroupTreeItem(this, i, msbuild.items[i]));
						}
						break;
				}
			}

			for (const i of this.project.solutionItems)
				children.push(new FileEntryTreeItem(this, i));

			return children;
		});
    }
}

class ConfigTreeItem extends TreeItem {
	constructor(parent : TreeItem, label: string) {
		super(parent, label);
		this.command = {title: 'select', command: 'vstools.setConfig', arguments: [this] };
	}
}
class ConfigsTreeItem extends TreeItem {
    constructor(parent : TreeItem, public solution : Solution) {
		super(parent, "configuration: " + solution.activeConfiguration.Configuration, TreeItemCollapsibleState.Collapsed);
		this.iconPath = new vscode.ThemeIcon("star");
	}
    createChildren(): Promise<TreeItem[]> {
		const unique = [...new Set(this.solution.configurations.map(i => i.Configuration))];
        return Promise.resolve(unique.map(i => new ConfigTreeItem(this, i)));
    }
}

class PlatformTreeItem extends TreeItem {
	constructor(parent : TreeItem, label: string) {
		super(parent, label);
		this.command = {title: 'select', command: 'vstools.setPlatform', arguments: [this] };
	}
}
class PlatformsTreeItem extends TreeItem {
    constructor(parent : TreeItem, public solution : Solution) {
		super(parent, "platform: " + solution.activeConfiguration.Platform, TreeItemCollapsibleState.Collapsed);
		this.iconPath = new vscode.ThemeIcon("star");
	}
    createChildren(): Promise<TreeItem[]> {
		const unique = [...new Set( this.solution.configurations.map(i => i.Platform))];
        return Promise.resolve(unique.map(i => new PlatformTreeItem(this, i)));
    }
}

function project_compare(a: Project, b: Project) {
	const am = a instanceof MsBuildProject;
	const bm = b instanceof MsBuildProject;
	return am != bm
		? (am ? 1 : -1)
		: compare(a.name, b.name);
}

class SolutionTreeItem extends TreeItem {
    constructor(private provider: SolutionExplorerProvider, public solution : Solution) {
		super(null, path.basename(solution.fullpath), TreeItemCollapsibleState.Expanded, solution.fullpath);
		this.contextValue = 'solution';
	}

    createChildren(): Promise<TreeItem[]> {
		const children : TreeItem[] = [];
		children.push(new ConfigsTreeItem(this, this.solution));
		children.push(new PlatformsTreeItem(this, this.solution));

		for (const id of Object.keys(this.solution.projects).sort((a, b) => project_compare(this.solution.projects[a], this.solution.projects[b]))) {
			const project = this.solution.projects[id];
			if (project.parent === this.solution)
				children.push(new ProjectTreeItem(this.provider, this, project, project === this.solution.startupProject));
		}
        return Promise.resolve(children);
    }
}

const SOLUTION_EXPLORER_MIME_TYPE = 'application/vnd.code.tree.solutionExplorer';
const URI_LIST_MIME_TYPE = 'text/uri-list';

class DataTransferItem extends vscode.DataTransferItem {
	constructor(public items : TreeItem[]) {
		super(items);
	}
	asString(): Thenable<string> { return Promise.resolve(""); }
	asFile(): vscode.DataTransferFile | undefined { return undefined; }
}

async function getFolder(item: TreeItem) : Promise<Folder | undefined> {
	return item && item instanceof FolderTreeItem ? item.folder
		: item && item instanceof ProjectTreeItem && item.project instanceof MsBuildProject ? (await item.project.getFolders(true))?.root
		: undefined;
}

function addFile(fullPath: string, dest: Folder, filters?: FolderTree) {
	const found = filters?.find_file(fullPath);
	if (found) {
		found[0].remove(found[1]);
		dest.add(found[1]);
	} else {
		dest.add(makeFileEntry(fullPath));
	}
}

export class SolutionExplorerProvider /*extends vscode.Disposable*/ implements vscode.TreeDataProvider<TreeItem>, vscode.TreeDragAndDropController<TreeItem> {//, vscode.FileDecorationProvider {
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
	public recreate(node: TreeItem): void {
		node.clearChildren();
		this._onDidChangeTreeData.fire(node);
	}
	public async collapse(node: TreeItem) {
		node.collapsibleState = TreeItemCollapsibleState.Collapsed;
		this.recreate(node);
	}

	public getTreeItem(element: TreeItem): vscode.TreeItem {
		return element;
	}

	public getRootByContext(element: TreeItem, type : string) {
		let i : TreeItem | null = element;
		while (i && !(i.contextValue != type))
			i = i.parent;
		return i;
	}

	public getRootByClass(element: TreeItem, type: any) {
		let i : TreeItem | null = element;
		while (i && !(i instanceof type))
			i = i.parent;
		return i;
	}

	public getProject(item: TreeItem) {
		return (this.getRootByClass(item, ProjectTreeItem) as ProjectTreeItem)?.project;
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
			this.children.push(new SolutionTreeItem(this, this.solution));
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

	constructor(public solution : Solution) {
		//super(() => this.dispose());
		const has : any = {
			hasOpen: 		["file", "project", "solution"],
			hasCut: 		["file", "multi"],
			hasCopy: 		["file", "multi"],
			hasPaste: 		["folder"],
			hasDelete: 		["file", "folder", "multi"],
			hasRename: 		["folder"],
			hasCreateFile: 	["folder", "project"],
			hasCreateFolder:["folder", "project"],
			hasSettings: 	["file", "project", "items", "solution"],
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
			let contextValue : string | undefined;
			if (ev.selection.length === 1) {
				const sel = ev.selection[0];
				contextValue = sel.contextValue;
				if (has.hasSettings.indexOf(contextValue) !== -1) {
					if (SettingsView.exists())
						this.updateSettings(sel);
				}
				if (contextValue === 'file')
					Extension.setCurrentProject(this.getProject(sel));
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
				vscode.window.showTextDocument(item.resourceUri);
		});

		Extension.registerCommand('vstools.setConfig', async (item: TreeItem) => {
			const parent	= item.parent as ConfigsTreeItem;
			const value		= item.label as string;
			this.solution.activeConfiguration = new Configuration(value, this.solution.activeConfiguration.Platform);
			parent.label = "configuration: " + value;
			this.collapse(parent);
		});
		Extension.registerCommand('vstools.setPlatform', async (item: TreeItem) => {
			const parent	= item.parent as PlatformsTreeItem;
			const value		= item.label as string;
			this.solution.activeConfiguration = new Configuration(this.solution.activeConfiguration.Configuration, value);
			parent.label = "platform: " + value;
			this.collapse(parent);
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
				const filters = project instanceof MsBuildProject ? await project.getFolders(true) : undefined;
				for (let file of (await vscode.env.clipboard.readText()).split('\n')) {
					const cut = file.startsWith('<cut:');
					if (cut)
						file = file.substring(file.indexOf('>') + 1);
					const filepath = path.resolve(vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? '', file);
					const stat = await getStat(filepath);
					if (stat && stat.type !== vscode.FileType.Directory)
						addFile(filepath, folder, filters);
				}
				this.recreate(item);
				if (project instanceof MsBuildProject)
					project.dirtyFilters();
			}
		});

		Extension.registerCommand('vstools.delete', async (item?: TreeItem) => {
			if (!item)
				item = this.treeView.selection[0];

			if (item instanceof TreeItem && item.parent) {
				const folder = await getFolder(item.parent);
				if (item instanceof FolderTreeItem)
					folder?.remove_folder(item.folder);
				else if (item instanceof FileEntryTreeItem)
					folder?.remove(item.entry);
				this.recreate(item.parent);

				const project 	= this.getProject(item);
				if (project instanceof MsBuildProject)
					project.dirtyFilters();
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
						item.folder.name = newName;

						const project 	= this.getProject(item);
						if (project instanceof MsBuildProject)
							project.dirtyFilters();
					}
					item.label = newName;
					this.refresh(item);
				}
			}
		});
		Extension.registerCommand('vstools.createFile', async (item?: TreeItem) => {
		});

		Extension.registerCommand('vstools.createFolder', async (item?: TreeItem) => {
			if (!item)
				item = this.treeView.selection[0];
			
			this.treeView.reveal(item, {expand: 1});
			const newName = await vscode.window.showInputBox({
				value: '',
				prompt: 'Enter the new folder name',
			});
			if (newName) {
				const folder = await getFolder(item);
				folder?.add_folder(new Folder(newName));
				this.recreate(item);

				const project 	= this.getProject(item);
				if (project instanceof MsBuildProject)
					project.dirtyFilters();
			}
		});

		Extension.registerCommand('vstools.refresh', () => {
			this.children = [];
			this.refresh();
		});

		Extension.registerCommand('vstools.settings', (item: TreeItem) => this.updateSettings(item));

		Extension.registerCommand('vstools.projectStartup', (item: ProjectTreeItem) => {
			if (this.solution.startupProject !== item.project) {
				this.solution.startupProject = item.project;
				for (const i of item.parent?.children || []) {
					if (i.highlight(i == item))
						this.refresh(i);
				}
			}
		});

		Extension.registerCommand('vstools.projectBuild', (item: ProjectTreeItem) => {
			const configuration = this.solution?.activeConfiguration;
			const settings = {
				VisualStudioVersion:	"17.0",
				Configuration: 			configuration?.Configuration,
				Platform: 				configuration?.Platform,
				file:					this.solution?.fullpath
			};

			item.project.build(settings);
		});

		Extension.registerCommand('vstools.projectViewByFilter',	item => {item.view_by = "filter"; this.collapse(item); });
		Extension.registerCommand('vstools.projectViewByFolder', 	item => {item.view_by = "folder"; this.collapse(item); });
		Extension.registerCommand('vstools.projectViewByItem', 		item => {item.view_by = "items"; this.collapse(item); });

	}

	public updateSettings(item: TreeItem) {
		if (item.contextValue == 'solution') {
			SettingsView.Set("Solution Settings", this.solution.activeConfiguration, this.solution);
			return;
		}
		const project 	= this.getProject(item);
		if (project instanceof MsBuildProject) {
			project.ready.then(async () => {
				const config = project.configuration[this.solution.activeConfiguration?.fullName][0];

				switch (item.contextValue) {
					case "project": {
						SettingsView.Set(`${item.label as string} Project Settings`, config, project);
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

					const files 	= transfer.value.filter((i : TreeItem) => i instanceof FileEntryTreeItem) as FileEntryTreeItem[];
					const folders 	= transfer.value.filter((i : TreeItem) => i instanceof FolderTreeItem) as FolderTreeItem[];

					for (const i of folders) {
						folder.add_folder(i.folder);
						if (i.parent && this.getRootByClass(i, ProjectTreeItem) === project) {
							await getFolder(i.parent).then(f => f?.remove_folder(i.folder));
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

					const filters	= project && (project instanceof ProjectTreeItem) && project.project instanceof MsBuildProject
									? await project.project.getFolders(true) : undefined;
					transfer.value.split(';').forEach((i : string) => addFile(Uri.parse(i).fsPath, folder, filters));
				}

				dirty.forEach(i => this.recreate(i));
				((project as ProjectTreeItem).project as MsBuildProject).dirtyFilters();

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

