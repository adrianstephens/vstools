import * as path from "path";
import {isDirectory} from "./fs";

export type Properties	= Record<string, string>;

export class Configuration {
	constructor(public readonly Configuration: string, public readonly Platform: string) {}

    public static make(config : string) : Configuration {
        const parts = config.split('|');
        return new Configuration(parts[0], (parts.length > 1) ? parts[1] : '');
    }
	public get fullName(): string {
		// Some configurations don't have the platform part
		return this.Platform
			? this.Configuration + '|' + this.Platform
			: this.Configuration;
	}
	public get properties() {
		return {"Configuration": this.Configuration, "Platform": this.Platform};
	}
}

//export type Data = Record<string, any>;

export type ProjectItemEntry = {
	name: string;
	data: Record<string, any>;
};

export function makeFileEntry(fullPath: string) {
	return {
		name: path.basename(fullPath),
		data: {fullPath: fullPath},
	};
}

export class Folder  {
	public folders: Folder[] = [];
	public entries: ProjectItemEntry[] = [];
	constructor(public name: string) {}

	public add(item : ProjectItemEntry) {
		this.entries.push(item);
	}
	public add_folder(item : Folder) {
		this.folders.push(item);
	}
	public remove(item : ProjectItemEntry) {
		const index = this.entries.indexOf(item);
		if (index >= 0)
			this.entries.splice(index, 1);
	}
	public remove_folder(item : Folder) {
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
	public find_entry(name: string, value: string) : ProjectItemEntry | undefined {
		return this.entries.find(i => i.data[name] == value);
	}

	public find_file(fullpath: string) : [Folder, ProjectItemEntry] | undefined {
		const entry = this.find_entry('fullPath', fullpath);
		if (entry)
			return [this, entry];

		for (const i of this.folders) {
			const found = i.find_file(fullpath);
			if (found)
				return found;
		}
	}
}

export class FolderTree {
	public root : Folder = new Folder("");

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
	public find_file(fullpath: string) {
		return this.root.find_file(fullpath);
	}
}

export class Project {
	public dependencies: Project[] = [];
	public childProjects: Project[] = [];
	public configuration: Record<string, [Configuration, boolean]> = {};
	public solutionItems: ProjectItemEntry[] = [];
	public webProperties: Record<string, string> = {};
	public ready: 		Promise<void> = Promise.resolve();

	static async makeEntry(basePath: string, fullPath: string, metadata?: any) : Promise<ProjectItemEntry> {
		return {
			name: path.basename(fullPath),
			data: {
				fullPath: fullPath,
				relativePath: path.relative(basePath, fullPath),
				isDirectory: await isDirectory(fullPath),
				...metadata
			}
		};
	}

	constructor(public parent:any, public type:string, public name:string, public fullpath:string, public guid:string) {
	}
	public addDependency(proj: Project): void {
		if (this.dependencies.indexOf(proj) === -1)
			this.dependencies.push(proj);
	}
	public addWebProperty(name: string, value: string): void {
		this.webProperties[name] = value;
	}
	public addFile(name: string, filepath: string): void {
		this.solutionItems.push( {
			name: name,
			data: {
				fullPath: filepath,
				relativePath: path.relative(this.fullpath, filepath),
			}
		});
	}
	public setProjectConfiguration(name: string, configuration: Configuration, include: boolean) {
		this.configuration[name] = [configuration, include];
	}
	public addChildProject(project: Project): void {
		this.childProjects.push(project);
		project.parent = this;
	}

	//public hasFile(filepath : string) : boolean {
	//	for (const i of this.solutionItems) {
	//		if (i.data.fullPath === filepath)
	//			return true;
	//	}
	//	return false;
	//}
	public build(settings : any) {
	}

	public configurationList() : string[] {
		return [...new Set(Object.keys(this.configuration).map(i => this.configuration[i][0].Configuration))];
	}
	public platformList() : string[] {
		return [...new Set(Object.keys(this.configuration).map(i => this.configuration[i][0].Platform))];
	}
	public clean() {
	}
	public getSetting(settings : Properties, name: string) {
	}
}

export class SolutionFolder extends Project {
}

export class WebProject extends Project {
}

export class WebDeploymentProject extends Project {
}

