import * as path from "path";

export class Configuration {
	constructor(public readonly configurationName: string, public readonly platformName: string) {}

    public static make(config : string) : Configuration {
        const parts = config.split('|');
        return new Configuration(parts[0], (parts.length > 1) ? parts[1] : '');
    }
	public get fullName(): string {
		// Some configurations don't have the platform part
		return this.platformName && this.platformName.length > 0
			? this.configurationName + '|' + this.platformName
			: this.configurationName;
	}
}

export type ProjectItemEntry = {
	name: string;
	fullPath: string;
	relativePath: string;
	isDirectory: boolean;
	isLink: boolean;
	dependentUpon: string | undefined;
};

export class Project {
	public dependencies: Project[] = [];
	public childProjects: Project[] = [];
	public configuration: { [id: string] : [Configuration, boolean] } = {};
	public solutionItems: { [id: string] : string } = {};
	public webProperties: { [id: string] : string } = {};

	constructor(public parent:any, public type:string, public name:string, public path:string, public guid:string) {
	}
	public addDependency(proj: Project): void {
		this.dependencies.push(proj);
	}
	public addWebProperty(name: string, value: string): void {
		this.webProperties[name] = value;
	}
	public addFile(name: string, filepath: string): void {
		this.solutionItems[name] = filepath;
	}
	public setProjectConfiguration(name: string, configuration: Configuration, include: boolean) {
		this.configuration[name] = [configuration, include];
	}
	public addChildProject(project: Project): void {
		this.childProjects.push(project);
		project.parent = this;
	}

	public async getProjectItemEntries(): Promise<ProjectItemEntry[]> {
		const result: ProjectItemEntry[] = [];
		for (const i in this.solutionItems) {
			const relativePath = this.solutionItems[i];
			result.push({
				name: i,
				fullPath: path.join(this.path, relativePath),
				relativePath: relativePath,
				isDirectory: false,
				isLink: false,
				dependentUpon: undefined,
			});
		}
		for (const i in this.childProjects) {
			const child = this.childProjects[i];
			result.push({
				name: child.name,
				fullPath: child.path,
				relativePath: path.relative(this.path, child.path),
				isDirectory: false,
				isLink: false,
				dependentUpon: undefined,
			});
		}
		return Promise.resolve(result);
	}
}

export class SolutionFolder extends Project {
}

export class WebProject extends Project {
}

export class WebDeploymentProject extends Project {
}

