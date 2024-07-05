import * as vscode from "vscode";
import * as path from "path";

import {Solution} from "./Solution";
import {Project, SolutionFolder} from "./Project";
import {MsBuildProject, Folder} from "./MsBuildProject";

export { TreeItemCollapsibleState, Command } from "vscode";
export let currentProject : Project | undefined;
export let currentSolution : Solution | undefined;

function VSDir(filepath : string | undefined) {
	return path.dirname(filepath || "") + path.sep;
}

export function ProjectDir() {
	return VSDir(currentProject?.path);
}
export function SolutionDir() {
	return VSDir(currentSolution?.path);
}



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

function getIconPath(name : string) {
	return path.join(__dirname, '..', 'icons', name);
}

function getSolution(project : Project) : Solution | undefined {
	for (let parent = project.parent; parent; parent = parent.parent) {
		if (parent instanceof Solution)
			return parent as Solution;
	}
}

export abstract class TreeItem extends vscode.TreeItem {
	protected children: TreeItem[] | null = null;

	constructor(
		public parent: TreeItem | null,
		label: string,
		collapsibleState: vscode.TreeItemCollapsibleState,
		path?: string,
	) {
		super(label, collapsibleState);
		this.id = this.createId();
		if (path)
			this.resourceUri = vscode.Uri.file(path);
	}

	public async getChildren(): Promise<TreeItem[]> {
		if (!this.children) {
			try {
				this.children = await this.createChildren();
			} catch {
				this.children = [];
			}
		}

		return this.children;
	}

	public collapse(): void {
		if (this.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
			if (this.children) 
				this.children.forEach(c => c.collapse());
			this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
		}
	}

	public dispose(): void {
		if (this.children)
			this.children.forEach(c => c.dispose());
		this.children = null;
	}

	protected createChildren(): Promise<TreeItem[]> {
		return Promise.resolve([]);
	}

	protected createId(): string {
		let id = fasthash(`${this.label}-${this.resourceUri?.fsPath ?? ''}`);
		if (this.parent)
			id = this.parent.id + '-' + id;
		return id;
	}
}


class FileTreeItem extends TreeItem {
    constructor(parent : TreeItem, fullPath: string) {
		super(parent, path.basename(fullPath), vscode.TreeItemCollapsibleState.None, fullPath);
		this.contextValue = 'file';
	}
}

class FolderTreeItem extends TreeItem {
    constructor(parent : TreeItem, public folder: Folder) {
		super(parent, folder.name, vscode.TreeItemCollapsibleState.Collapsed);
		this.iconPath = getIconPath('folder.svg');
	}
	protected async createChildren(): Promise<TreeItem[]> {
		const children : TreeItem[] = [];
		for (const i of this.folder.folders)
			children.push(new FolderTreeItem(this, i));
		for (const i of this.folder.entries)
			children.push(new FileTreeItem(this, i.fullPath));
        return Promise.resolve(children);
    }
}

class DependencyTreeItem extends TreeItem {
    constructor(parent : TreeItem, project: Project) {
		super(parent, path.basename(project.name), vscode.TreeItemCollapsibleState.None, project.path);
	}
}

class DependenciesTreeItem extends TreeItem {
    constructor(parent : TreeItem, public dependencies: Project[]) {
		super(parent, "references", vscode.TreeItemCollapsibleState.Collapsed);
		this.iconPath = getIconPath('ReferenceGroup-dark.svg');
	}
	protected async createChildren(): Promise<TreeItem[]> {
		const children : TreeItem[] = [];
		for (const i of this.dependencies)
			children.push(new DependencyTreeItem(this, i));
        return Promise.resolve(children);
    }
}

class ProjectTreeItem extends TreeItem {
    constructor(parent : TreeItem, public project : Project) {
		super(parent, path.basename(project.name), vscode.TreeItemCollapsibleState.Collapsed, project.path);
		if (project instanceof SolutionFolder)
			this.iconPath = getIconPath('folder.svg');
		else if (this.project instanceof MsBuildProject)
			this.iconPath = getIconPath('vcxproj.svg');
		this.contextValue = 'project';
	}
	protected async createChildren(): Promise<TreeItem[]> {
		const children : TreeItem[] = [];

		if (this.project.dependencies.length)
			children.push(new DependenciesTreeItem(this, this.project.dependencies));

		const childProjects = this.project.childProjects;
		for (const i in childProjects) {
			const child = childProjects[i];
			children.push(new ProjectTreeItem(this, child));
		}
		
		const solutionItems = this.project.solutionItems;
		for (const i in solutionItems)
			children.push(new FileTreeItem(this, solutionItems[i]));

		if (this.project instanceof MsBuildProject) {
			const msbuild = this.project as MsBuildProject;
			await msbuild.ready;
			for (const i of msbuild.foldertree.root.folders) {
				children.push(new FolderTreeItem(this, i));
			}
		}

        return Promise.resolve(children);
    }

	public build() {
		if (vscode.workspace.workspaceFolders) {
			currentProject = this.project;
			currentSolution = getSolution(this.project);

			const env = {"path": "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\MSBuild\\Current\\Bin;${env.path}"};

			const solutionPath = currentSolution?.path || "";

			const properties = {
				VisualStudioVersion:	"17.0",
				SolutionDir: 			SolutionDir(),
				Configuration: 			currentSolution?.activeConfiguration.configurationName,
				Platform: 				currentSolution?.activeConfiguration.platformName,
			};

			const task = new vscode.Task(
				{ type: 'shell', task: 'compile' },
				vscode.workspace.workspaceFolders[0],
				'build project',
				'msbuild source',
				new vscode.ShellExecution(
					'msbuild',
					[
						...Object.entries(properties).map(([k, v]) => "/property:" + k + "=" + v),
						"/target:" + this.label,
						solutionPath
					],
					{
						env: env
					}
				),
				"$msbuild"
			);
			vscode.tasks.executeTask(task);
		}
	}

}

class SolutionTreeItem extends TreeItem {
    constructor(public solution : Solution) {
		super(null, path.basename(solution.path), vscode.TreeItemCollapsibleState.Expanded, solution.path);
	}

    protected createChildren(): Promise<TreeItem[]> {
		const children : TreeItem[] = [];
		for (const id in this.solution.projects) {
			const project = this.solution.projects[id];
			if (project.parent === this.solution)
				children.push(new ProjectTreeItem(this, project));
		}
        return Promise.resolve(children);
    }
}

async function openFile(uri : vscode.Uri) {
	const options: vscode.TextDocumentShowOptions = {
		preview: false,
		preserveFocus: false
	};
	try {
		const document = await vscode.workspace.openTextDocument(uri);
		vscode.window.showTextDocument(document, options);
	} catch (e) {
		//
	}
}

export class SolutionExplorerProvider extends vscode.Disposable implements vscode.TreeDataProvider<TreeItem> {
	private treeView: vscode.TreeView<TreeItem> | undefined;
	private children : TreeItem[] = [];

	constructor(private solution : Solution) {
		super(() => this.dispose());
		const options = {
			treeDataProvider: this,
			//dragAndDropController: this.dragAndDropController,
			canSelectMany: true,
			showCollapseAll: true
		};
		this.treeView = vscode.window.createTreeView('sln_view', options);
		this.treeView?.onDidChangeSelection(ev => {
			let selectionContext = undefined;
			if (ev.selection.length === 1) {
				selectionContext = ev.selection[0].contextValue;
				if (selectionContext == 'file' && ev.selection[0].resourceUri)
					openFile(ev.selection[0].resourceUri);

			} else if (ev.selection.length > 1) {
				//selectionContext = ContextValues.multipleSelection;
			}
			vscode.commands.executeCommand('setContext', 'selectionContext', selectionContext);
		});
	}

	public unregister() {
		if (this.treeView) {
			this.treeView.dispose();
			this.treeView = undefined;
		}
	}

	public getTreeItem(element: TreeItem): vscode.TreeItem {
		return element;
	}

	public getSelectedItems(): readonly TreeItem[] | undefined {
		return this.treeView?.selection;
	}

	public getChildren(element?: TreeItem): Thenable<TreeItem[]> | undefined {
		if (element)
			return element.getChildren();

		if (!this.children.length)
			this.children.push(new SolutionTreeItem(this.solution));
		return Promise.resolve(this.children);
	}

	public getParent(element: TreeItem): TreeItem | null {
		return element.parent;
	}

	public async selectFile(filepath: string): Promise<void> {
	}

	public selectActiveDocument(): Promise<void> {
		if (vscode.window.activeTextEditor) {
			return this.selectFile(vscode.window.activeTextEditor.document.uri.fsPath);
		} else {
			return Promise.resolve();
		}
	}

	public focus(): void {
		if (this.treeView) {
			const element = this.treeView.selection[0];
			this.treeView.reveal(element, { select: false, focus: true });
		}
	}
}
