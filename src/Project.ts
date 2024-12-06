import * as vscode from 'vscode';
import * as path from 'path';
import { arrayRemove } from '@shared/utils';
import { Solution, write_section } from './Solution';

export type Properties	= Record<string, string>;

export interface ProjectItemEntry {
	name: string;
	data: Record<string, any>;
}

export function makeFileEntry(fullPath: string) {
	return {
		name: path.basename(fullPath),
		data: {fullPath: fullPath},
	};
}

export class Folder  {
	public folders: Folder[] = [];
	
	constructor(public name: string, public entries: ProjectItemEntry[] = []) {}

	public add(item : ProjectItemEntry) {
		this.entries.push(item);
	}
	public addFolder(item : Folder) {
		this.folders.push(item);
	}
	public remove(item : ProjectItemEntry) {
		const index = this.entries.indexOf(item);
		if (index >= 0)
			this.entries.splice(index, 1);
	}
	public removeFolder(item : Folder) {
		const index = this.folders.indexOf(item);
		if (index >= 0)
			this.folders.splice(index, 1);
	}
	public find(item : ProjectItemEntry) : Folder | undefined {
		if (this.entries.indexOf(item) !== -1)
			return this;
		for (const i of this.folders) {
			const found = i.find(item);
			if (found)
				return found;
		}
	}
	public findEntry(name: string, value: string) : ProjectItemEntry | undefined {
		return this.entries.find(i => i.data[name] == value);
	}

	public findFile(fullpath: string) : [Folder, ProjectItemEntry] | undefined {
		const entry = this.findEntry('fullPath', fullpath);
		if (entry)
			return [this, entry];

		for (const i of this.folders) {
			const found = i.findFile(fullpath);
			if (found)
				return found;
		}
	}
}

export class FolderTree {
	constructor(public root = new Folder("")) {}

	public addDirectory(relativePath?: string) : Folder {
		let folder  = this.root;
		if (relativePath) {
			const parts = relativePath.split(path.sep);
			for (const part of parts) {
				if (part && part !== "." && part != "..") {
					let next = folder.folders.find(e => e.name == part);
					if (!next) {
						next = new Folder(part);
						folder.folders.push(next);
					}
					folder = next;
				}
			}
		}
		return folder;
	}
	public add(relativePath: string, item : ProjectItemEntry) {
		this.addDirectory(path.dirname(relativePath)).add(item);
	}
	public find(item : ProjectItemEntry) {
		return this.root.find(item);
	}
	public findFile(fullpath: string) {
		return this.root.findFile(fullpath);
	}
}

export interface ProjectConfiguration {
	Configuration:	string,
	Platform:		string,
	build:			boolean,
	deploy:			boolean
}

export class Project extends vscode.Disposable {
	public static all: Record<string, Project> = {};

	protected _onDidChange	= new vscode.EventEmitter<string>();
	readonly onDidChange	= this._onDidChange.event;

	public dependencies:	Project[] = [];
	public childProjects:	Project[] = [];
	public configuration:	Record<string, ProjectConfiguration> = {};
	public webProperties:	Record<string, string> = {};
	public ready: 			Promise<void> = Promise.resolve();

	constructor(public type:string, public name:string, public fullpath:string, public guid:string, protected solution_dir: string) {
		super(() => delete Project.all[this.guid]);
		Project.all[this.guid] = this;
	}
	public addDependency(proj: Project): void {
		if (this.dependencies.indexOf(proj) === -1)
			this.dependencies.push(proj);
	}
	public addWebProperty(name: string, value: string): void {
		this.webProperties[name] = value;
	}
	public setProjectConfiguration(name: string, config: ProjectConfiguration) {
		this.configuration[name] = config;
	}
	public addProject(project?: Project): void {
		if (project) {
			this.childProjects.push(project);
			//project.parent = this;
		}
	}
	public removeProject(project?: Project): void {
		if (project)
			arrayRemove(this.childProjects, project);
	}
	public addFile(name: string, filepath: string, markDirty = true): boolean {
		return false;
	}
	public removeEntry(entry: ProjectItemEntry): boolean {
		return false;
	}
	public removeFolder(folder: Folder): boolean {
		return false;
	}
	public removeFile(file: string) {
		return false;
	}
	public renameFolder(folder: Folder, newname: string) : boolean {
		folder.name = newname;
		return true;
	}
	public getFolders(view: string) {
		return Promise.resolve(new FolderTree());
	}

	public build(settings : any) : void {
	}

	public debug(settings : any) : any {
	}

	public configurationList() : string[] {
		return [...new Set(Object.values(this.configuration).map(i => i.Configuration))];
	}
	public platformList() : string[] {
		return [...new Set(Object.values(this.configuration).map(i => i.Platform))];
	}

	public dirty() {
		this._onDidChange.fire(this.fullpath);
	}

	public clean() {
	}

	public getSetting(settings : Properties, name: string) {
	}

	public validConfig(config: ProjectConfiguration) {
		return true;
	}

	public solutionWrite(basePath: string) : string {
		return '';
	}
}

export class SolutionFolder extends Project {
	public solutionItems: ProjectItemEntry[] = [];

	constructor(public parent:Solution, public type:string, public name:string, public fullpath:string, public guid:string, protected solution_dir: string) {
		super(type, name, fullpath, guid, solution_dir);
	}

	public dirty() {
		this.parent.dirty();
	}

	public solutionWrite(basePath: string) : string {
		return write_section('ProjectSection', 'SolutionItems', 'preProject', Object.fromEntries(this.solutionItems.map(i => {
			const rel = path.relative(basePath, i.data.fullPath);
			return [rel, rel];
		})));
	}

	public addFile(name: string, filepath: string, markDirty: boolean): boolean {
		this.solutionItems.push( {
			name: name,
			data: {
				fullPath: filepath,
				relativePath: path.relative(this.fullpath, filepath),
			}
		});
		if (markDirty)
			this.dirty();
		return true;
	}
	
	public removeEntry(entry: ProjectItemEntry): boolean {
		this.dirty();
		return arrayRemove(this.solutionItems, entry);
	}
	
	public removeFile(file: string): boolean {
		const index = this.solutionItems.findIndex(i => i.data.fullPath == file);
		if (index != -1) {
			this.solutionItems.splice(index, 1);
			this.dirty();
			return true;
		}
		return false;
	}
	
	public getFolders(view: string) : Promise<FolderTree> {
		return Promise.resolve(new FolderTree(new Folder('', this.solutionItems)));
	}
}

export class WebProject extends Project {
}

export class WebDeploymentProject extends Project {
}

