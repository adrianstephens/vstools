import 'source-map-support/register';
import * as vscode from 'vscode';
import * as path from "path";
import * as nodefs from 'fs';
import * as fs from './modules/fs';
import * as xml from "./modules/xml";
import * as utils from './modules/utils';
import * as MsBuild from './MsBuild';
import {Solution} from "./Solution";
import {Project, SolutionFolder} from "./Project";
import {SolutionExplorerProvider} from "./SolutionView";

const Uri	= vscode.Uri;
export let vsdir = process.env.vsdir ?? '';

//-----------------------------------------------------------------------------
//	xml helpers
//-----------------------------------------------------------------------------

export async function xml_load(filename : string) : Promise<xml.Element | undefined> {
	return fs.loadTextFile(filename).then(content	=> content ? xml.parse(content) : undefined);
}

export async function xml_save(filename : string, element: xml.Element) : Promise<void> {
/*
	vscode.workspace.fs.writeFile(uri, Buffer.from(xml.js2xml(element), "utf-8"))
		.then(
			()		=> {},
			error	=> console.log(`Failed to save ${uri.fsPath} : ${error}`)
		);
*/
	nodefs.writeFile(filename, Buffer.from(element.toString(), "utf-8"), error => {
		if (error)
			console.log(`Failed to save ${filename} : ${error}`);
	});
}

export const XMLCache	= utils.makeCache(xml_load);

//-----------------------------------------------------------------------------
//	ui helpers
//-----------------------------------------------------------------------------

export async function yesno(message: string) {
	return await vscode.window.showInformationMessage(message, { modal: true }, 'Yes', 'No') === 'Yes';
}

export async function searchOption<T extends vscode.QuickPickItem>(title: string, placeholder: string, initialSearch: string, itemsResolver: (search: string)=>Promise<T[]>) {
	const input 		= vscode.window.createQuickPick<T>();
	input.title 		= title;
	input.placeholder 	= placeholder;
	input.value 		= initialSearch;
	input.items			= await itemsResolver(initialSearch);

	input.show();

	return new Promise<T>(resolve => {
		input.onDidChangeValue(async value => {
			if (value)
				input.items	= await itemsResolver(value);
		});

		input.onDidTriggerButton(item => {
			if (item === vscode.QuickInputButtons.Back) {
				//wizard?.prev();
				resolve(input.activeItems[0]);
			} else {
				//wizard?.next();
				resolve(input.activeItems[0]);
			}
			input.hide();
		});

		input.onDidAccept(() => {
			//wizard?.next();
			resolve(input.activeItems[0]);
			input.hide();
		});
	});
}

export interface SubMenu<T extends vscode.QuickPickItem> extends vscode.QuickPickItem {
	title?: string;
	children: (T|SubMenu<T>)[];
}

function isSubMenu<T extends vscode.QuickPickItem>(item: T|SubMenu<T>): item is SubMenu<T> {
	return 'children' in item;// as SubMenu<T>).children;
}

export async function hierarchicalMenu<T extends vscode.QuickPickItem>(menu: (T|SubMenu<T>)[], title?: string): Promise<T|undefined> {
	const quick = vscode.window.createQuickPick<T|SubMenu<T>>();
	quick.ignoreFocusOut = true;

	async function recurse(menu: (T|SubMenu<T>)[], title: string, back: boolean): Promise<T|undefined> {
		for (;;) {
			quick.title		= title;
			quick.items		= menu;
			quick.buttons	= back ? [vscode.QuickInputButtons.Back] : [];
			quick.show();

			const item = await new Promise<T|SubMenu<T>|undefined>(resolve => {
				quick.onDidTriggerButton(button => {
					if (button === vscode.QuickInputButtons.Back)
						resolve(undefined);
				});
				quick.onDidAccept(async () => {
					resolve(quick.selectedItems[0]);
				});
	
			});

			if (!item)
				return;
			
			if (!isSubMenu(item))
				return item;

			const item2 = await recurse(item.children, item.title ?? `Select a ${item.label}`, true);
			if (item2)
				return item2;
		}
	}
	const item = await recurse(menu, title ?? '', false);
	quick.dispose();
	return item;

/*
	for (;;) {
		const item = await vscode.window.showQuickPick(menu, { placeHolder: `Select a ${label}` });
		if (!item || item.label === '..')
			return;
		
		if (!isSubMenu(item))
			return item;

		const item2 = await hierarchicalMenu<T>(item.children, item.title ?? `Select a ${item.label}`);
		if (item2)
			return item2;
	}
		*/
}


//-----------------------------------------------------------------------------
//	general
//-----------------------------------------------------------------------------

async function substitutions(value: string): Promise<string> {
	const re = /\${(([.\w]+)}|env:(\w+)}|command:([.\w]+)([,}]))/g;

	return utils.async_replace_back(value, re, async (m: RegExpExecArray, right:string) => {
		if (m[2]) {
			//simple
			if (m[2] == 'workspaceFolder')
				return (vscode.workspace.workspaceFolders?.[0].uri.fsPath || '') + right;
			return m[2] + right;

		} else if (m[3]) {
			//env
			return (process.env[m[3]] || '') + right;

		} else if (m[4]) {
			if (m[5] == '}')
				return vscode.commands.executeCommand(m[4]).then(result => result?.toString() + right);

			const end = right.indexOf('}');
			const args = right.substring(0, end).split(',');

			return vscode.commands.executeCommand(m[4], ...args).then((result: any) => {
				return result + right.substring(end + 1);
			});
		}
		return "";
	});
}


export function createTask(name: string, target: string, solution: string, properties: Record<string, string>, group?: vscode.TaskGroup): vscode.Task {
	const definition: vscode.TaskDefinition = {
		type:		'msbuild',
		target,
		solution,
		properties
	};

	const task = new vscode.Task(
		definition,
		vscode.TaskScope.Workspace,
		name,
		'msbuild',
		new vscode.ProcessExecution(
			`${vsdir}\\MSBuild\\Current\\Bin\\msbuild.exe`, [
				...Object.entries(properties).map(([k, v]) => `/property:${k}=${v}`),
				`/target:${target}`,
				solution
			]
		),
		'$msbuild'		//problem matcher
	);
	task.group = group;
	return task;
}

async function get_exec_subs(definition: vscode.TaskDefinition) {
	const properties	= await Promise.all(Object.keys(definition.properties).map(async k => `/property:${k}=${await substitutions(definition.properties[k])}`));
	const switches		= definition.switches ? await Promise.all(Object.keys(definition.switches).map(async k => `/${k}:${await substitutions(definition.switches[k])}`)) : [];

	return new vscode.ProcessExecution(
		`${vsdir}\\MSBuild\\Current\\Bin\\msbuild.exe`,
		[
			...properties,
			...switches,
			`/target:${definition.target}`,
			await substitutions(definition.solution),
		]
	);
}

interface ProjectAndSolution {
	project: 	Project;
	solution:	Solution;
}

class ExtensionClass implements vscode.TaskProvider, vscode.DebugConfigurationProvider {
	public current?:	ProjectAndSolution;
	public explorer?: 	SolutionExplorerProvider;

	private solutions:	Solution[] = [];
	private tasks?:		Promise<vscode.Task[]>;

	constructor(public context: vscode.ExtensionContext) {
		this.registerCommand('vstools.addSolution',	(uri?: vscode.Uri) => {
			if (uri) {
				Solution.read(uri.fsPath).then(solution => {
					if (solution)
						this.addSolution(solution);
				});
			}
		});
	}

	public registerCommand(command: string, callback: (...args: any[]) => any, thisArg?: any) {
		this.context.subscriptions.push(vscode.commands.registerCommand(command, callback));
	}

	public absoluteUri(relativePath: string) {
		return Uri.joinPath(this.context.extensionUri, relativePath);
	}

	public getIcon(name : string) {
		return {
			light: this.absoluteUri(`assets/${name}.svg`),
			dark: this.absoluteUri(`assets/dark/${name}.svg`)
		};
	}

	public getProjectAndSolution(projname?: string) : ProjectAndSolution | undefined {
		if (!projname)
			return this.current;

		if (this.current) {
			const project = this.current.solution.projectByName(projname);
			if (project)
				return {project, solution: this.current.solution};
		}

		for (const solution of this.solutions) {
			const project = solution.projectByName(projname);
			if (project)
				return {project, solution};
		}
	}

	public getProject(projname?: string) : Project | undefined {
		return this.getProjectAndSolution(projname)?.project;
	}


    provideTasks(): Promise<vscode.Task[]> {
		if (!vscode.workspace.getConfiguration('msbuild').get<boolean>('autoDetect'))
			return Promise.resolve([]);

		if (!this.tasks) {
			this.tasks = (async () => {
				const tasks: vscode.Task[] = [];

				const properties = {
					Configuration:	"${command:vstools.configuration}",
					Platform:		"${command:vstools.platform}"
				};

				for (const solution of this.solutions) {
					const solutionPath = solution.fullpath;
					// Solution-level tasks
					tasks.push(createTask("Build Solution", "Build", solutionPath, properties, vscode.TaskGroup.Build));
					tasks.push(createTask("Clean Solution", "Clean", solutionPath, properties, vscode.TaskGroup.Clean));
					tasks.push(createTask("Rebuild Solution", "Rebuild", solutionPath, properties, vscode.TaskGroup.Rebuild));

					// Startup project tasks
					tasks.push(createTask("Build Startup Project", '`${command:vstools.startupProject}', solutionPath, properties, vscode.TaskGroup.Build));
					//tasks.push(createTask("Run Startup Project", '${command:vstools.startupProject}:Run', solutionPath, properties));
					//tasks.push(createTask("Debug Startup Project", '${command:vstools.startupProject}:RunDebug', solutionPath, properties));

					// Project-level tasks
					for (const project of Object.values(solution.projects)) {
						if (!(project instanceof SolutionFolder)) {
							tasks.push(createTask(`Build ${project.name}`, `${project.name}`, solutionPath, properties, vscode.TaskGroup.Build));
							tasks.push(createTask(`Clean ${project.name}`, `${project.name}:Clean`, solutionPath, properties, vscode.TaskGroup.Clean));
							tasks.push(createTask(`Rebuild ${project.name}`, `${project.name}:Rebuild`, solutionPath, properties, vscode.TaskGroup.Rebuild));
						}
					}
				}

	/*
				for (const project of Object.values(this.solution.projects)) {
					for (const i in project.configuration) {
						const c = project.configuration[i];
						if (!c.build)
							continue;

						// use Solution's version
						const parts 	= i.split('|');
						const config 	= this.solution.configurationList()[+parts[0]];
						const platform	= this.solution.platformList()[+parts[1]];

						const definition = {
							type: 		'msbuild',
							properties: {
								//VisualStudioVersion:"17.0",
								Configuration:	config,
								Platform: 		platform,
							},
							target: 	project.name,
							solution: 	this.solution.fullpath,
						};
						const task = new vscode.Task(
							definition,
							vscode.TaskScope.Workspace,	//scope
							`${project.name} ${config}|${platform}`,	//name
							'msbuild',
							this.get_exec(definition),
							'$msbuild',									//problem matcher
						);
						task.group = vscode.TaskGroup.Build;

						tasks.push(task);
					}
				}
				*/
				return tasks;
			})();
		}
		return this.tasks;
    }
    async resolveTask(task: vscode.Task): Promise<vscode.Task | undefined> {
		if (task.definition.type === 'msbuild') {
			return new vscode.Task(
				task.definition,
				vscode.TaskScope.Workspace,	//scope
				task.name,
				task.source,
				await get_exec_subs(task.definition),
				task.problemMatchers,
			);
		}
		return undefined;
    }

	async provideDebugConfigurations(): Promise<vscode.DebugConfiguration[]> {
		const configs: vscode.DebugConfiguration[] = [];

        // Generate debug configurations for each project
		for (const solution of this.solutions) {
			for (const project of Object.values(solution.projects)) {
				const settings = project.debug(0);
				configs.push({...settings,
					name: `Debug ${project.name}`,
					request: 'launch',
					stopAtEntry: settings.stopAtEntry,
					cwd: '${workspaceFolder}',
					environment: settings.environment,
					console: 'externalTerminal'
				});
			}
		}
		return configs;
    }

	async resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, debugConfiguration: vscode.DebugConfiguration) {
		if (debugConfiguration.program.startsWith('${vstools:')) {
			const parsed = (await substitutions(debugConfiguration.program.slice(10, -1))).split(',');
			const settings : Record<string, string> = Object.fromEntries(parsed.filter(i => i.includes('=')).map(i => i.split('=')));
			if (settings.Configuration?.includes('|')) {
				const [c, p] = settings.Configuration.split('|');
				settings.Configuration = c;
				settings.Platform = p;
			}
			const project = this.getProject(parsed[0]);
			return {
				...debugConfiguration,
				...await project?.debug(settings)
			};
		}
		return debugConfiguration;
	}

	resolveDebugConfigurationWithSubstitutedVariables(folder: vscode.WorkspaceFolder | undefined, debugConfiguration: vscode.DebugConfiguration) {
		return debugConfiguration;
	}

	
	public addSolution(solution: Solution) {
		if (this.solutions.length == 0) {
			this.current	= {project: solution.startup!, solution};
			this.explorer	= new SolutionExplorerProvider();

			vscode.commands.executeCommand('setContext', 'vstools.loaded', true);

			//this.registerCommand('vstools.solutionPath', 	() => solution.fullpath);
			//this.registerCommand('vstools.solutionDir', 		() => VSDir(solution.fullpath));
			this.registerCommand('vstools.startupExecutable',	() =>
				this.current?.solution.startup?.name
			);
			this.registerCommand('vstools.startupProject',	() =>
				this.current?.solution.startup?.name ?? ''
			);
			this.registerCommand('vstools.projectDir', 	(project?: string) => {
				const proj = this.getProject();
				if (proj)
					return path.dirname(proj.fullpath) + path.sep;
			});
			this.registerCommand('vstools.projectName', 	() =>
				this.current?.project.name
			);
			this.registerCommand('vstools.configuration', 	() => 
				this.current?.solution.activeConfiguration.Configuration
			);
			this.registerCommand('vstools.platform', 		() =>
				this.current?.solution?.activeConfiguration.Platform
			);
			this.registerCommand('vstools.projectConfiguration', (project?: string) => {
				const ps = this.getProjectAndSolution(project);
				if (ps) {
					const config = ps.project.configuration[ps.solution.active.join('|')];
					return [config.Configuration, config.Platform].join('|');
				}
			});
			this.registerCommand('vstools.projectSetting', (setting: string) => {
				const ps = this.current ?? {project:solution.startup, solution};
				if (ps.project) {
					const config = ps.project.configuration[ps.solution.active.join('|')];
					return ps.project.getSetting({"Configuration": config.Configuration, "Platform": config.Platform}, setting);
				}
			});

			this.context.subscriptions.push(vscode.tasks.registerTaskProvider('msbuild', this));
			this.context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('cppvsdbg', this, vscode.DebugConfigurationProviderTriggerKind.Dynamic));
		}

		this.solutions.push(solution);
		this.context.subscriptions.push(solution);
		this.explorer!.addSolution(solution);
	}
}


//-----------------------------------------------------------------------------
//	main entry
//-----------------------------------------------------------------------------

export let Extension: ExtensionClass;

export function activate(context: vscode.ExtensionContext) {
	Extension = new ExtensionClass(context);

	if (!vsdir) {
		MsBuild.Locations.GetFoldersInVSInstalls().then(vs => {
			if (vs.length)
				vsdir = vs.at(-1)!;
		});
	}

	if (vscode.workspace.workspaceFolders) {
		vscode.workspace.findFiles('*.sln').then(async slns =>
			slns.map(i => Solution.read(i.fsPath).then(solution => solution && Extension.addSolution(solution)))
		);

		fs.onChange(path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, '*.sln'), (fullpath, mode) => {
			if (mode === fs.Change.created)
				Solution.read(fullpath).then(solution => solution && Extension.addSolution(solution));
		});
	}
}

//export async function deactivate() {
//}
