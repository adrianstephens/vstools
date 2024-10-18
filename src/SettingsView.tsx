import * as vscode from "vscode";
import * as xml from "./modules/xml";
import * as utils from "./modules/utils";
import * as MsBuild from "./MsBuild";
import * as insensitive from './modules/CaseInsensitive';
import {XMLCache, Extension} from "./extension";
import {Solution} from "./Solution";
import {Properties} from "./Project";
import {MsBuildProjectBase} from "./MsBuildProject";
import {jsx, fragment, codicons, Label, ClickableIcon} from "./modules/jsx";

const Uri = vscode.Uri;
let the_panel: 					vscode.WebviewPanel | undefined;
let disposeDidChangeViewState:	vscode.Disposable;
let disposeDidReceiveMessage:	vscode.Disposable;

//-----------------------------------------------------------------------------
//	HTML helpers
//-----------------------------------------------------------------------------


/*
function Multi(props: {id:string}) {
	return <div id={props.id} class="multi">
		<div>
			<input type="text"/>
			<ClickableIcon id={props.id+'.delete'} code={codicons.trash}/>;
		</div>
	</div>;
}
*/
interface DropDownEntry {
	value:		string,
	display:	string,
}

function DropDownList(props: {id: string, values: DropDownEntry[], value?: string}) {
	return <select id={props.id} name={props.id} className="inherit">
		{props.value ? <option value="">{props.value}</option> : ''}
		{props.values.map(i => <option value={i.value}>{i.display}</option>)}
	</select>;
}

function CheckList(props: {values: string[], value?: string}) {
	return <>{props.values.map(name =>
		<div><input type="checkbox" id={name} name={name} checked={name == props.value}><label for={name}>{name}</label></input></div>
	)}</>;
}

function InputItem(props: {id:string, item: xml.Element}) {
	const {id, item} = props;
	const id2 = id+'.resolved';

	switch (item.name) {
		case "IntProperty":
		case "StringProperty":
		case "DynamicEnumProperty":
			return <>
				<input type="text" id={id} name={id}/>
				<input type="text" id={id2} readonly/>
			</>;

		case "StringListProperty":
			return <>
				<textarea id={id} name={id} rows="1"></textarea>
				<textarea id={id2} rows="1" readonly></textarea>
			</>;

		case "BoolProperty":
			return <>
				<DropDownList id={id}
					values={[
						{value: item.attributes.Switch ? '' : 'false', display:"No"},
						{value: item.attributes.Switch ? '/' + item.attributes.Switch : 'true', display: "Yes"}
					]}
				/>
				<input type="text" id={id2} readonly={true}/>
			</>;

		case "EnumProperty":
			return <>
				<DropDownList id={id}
					values={item.children.filter(e => xml.isElement(e)).map(e => ({value: e.attributes.Name, display: e.attributes.DisplayName}))}
				/>
				<input type="text" id={id2} readonly={true}/>
			</>;

		default:
			return;
	}
}

//-----------------------------------------------------------------------------
//	Schema
//-----------------------------------------------------------------------------

type SchemaEntry = {
	raw: 		xml.Element,
	source:		string,
	persist:	string,
};

type SchemaCategory = {
	name: 		string,
	display: 	string,
	entries: 	SchemaEntry[];
};

function get_attribute(element: xml.Element, name:string) {
	return element.attributes[name] ?? element.elements[`${element.name}.${name}`]?.firstElement()?.firstText();
}

function get_bool_string(value?: string) {
	return value?.toLowerCase() !== "false";
}

function has_context(source: xml.Element, context: string) {
	const contexts = source.elements.Context?.firstText();
	if (!contexts)
		return true;
	const contexts2 = contexts.split(';');
	return contexts2.includes(context) || contexts2.includes('*');
}

class SchemaFile {
	display?:	string;
	attributes: xml.Attributes;
	categories: Record<string, string> = {};
	entries:	Record<string, SchemaEntry> = {};

	constructor(root: xml.Element) {
		this.attributes		= root.attributes;
		this.display		= get_attribute(root, 'DisplayName');
		let default_source	= '';
		let default_persist	= '';
	
		for (const item of root.allElements()) {
			if (item.name === "Rule.DataSource") {
				const element = item.firstElement();
				default_source	= element?.attributes.ItemType || '';
				default_persist	= element?.attributes.Persistence || '';

			} else if (item.name === "Rule.Categories") {
				Array.from(item.elements.Category).filter(cat => cat.attributes.Subtype !== 'Search').forEach(cat => {
					this.categories[cat.attributes.Name ?? ''] = get_attribute(cat, 'DisplayName');
				});

			} else if (item.name.endsWith('Property') && item.attributes.Visible?.toLowerCase() != "false") {
				const datasource = item.elements[item.name + '.DataSource']?.firstElement();
				const source	= datasource?.attributes.ItemType		|| default_source;
				const persist	= datasource?.attributes.Persistence	|| default_persist;
				if (persist === 'UserFile' || persist === 'ProjectFile' || persist === 'ProjectFileWithInterception') {
					this.entries[item.attributes.Name] = {
						raw: 		item,
						source:		source,
						persist:	persist
					};
				}
			}
		}
	}

	static async read(fullPath : string) : Promise<SchemaFile|undefined> {
		return XMLCache.get(fullPath).then(doc => {
			let root = doc?.firstElement();
			if (root?.name !== "Rule") {
				root = root?.firstElement();
				if (root?.name !== "Rule")
					return;
			}
			return new SchemaFile(root);
		});
	}

	public combine(b: SchemaFile) {
		if (!this.display)
			this.display = b.display;
		
		this.attributes = {...b.attributes, ...this.attributes};

		if (b.attributes.OverrideMode === 'Replace') {
			this.entries = b.entries;
		} else {
			this.entries = {...this.entries, ...b.entries};
		}
	}
}

function split_variable(name: string) {
	const parts = name.split('.');
	return parts.length > 1 ? parts : ['', name];
}
function make_variable(space:string, name: string) {
	return space ? `${space}.${name}` : name;
}

class Schema {
	name: 		string;
	display: 	string;
	order: 		number;
	categories : SchemaCategory[] = [];

	constructor(file: SchemaFile, have_source: string[]) {
		this.name 		= file.attributes.Name;
		this.display 	= file.display ?? this.name;
		this.order 		= +(file.attributes.Order??0);
		this.categories	= Object.entries(file.categories).map(([k, v]) => ({name: k, display: v ?? k, entries: []}));

		//sort into categories
		for (const item of Object.values(file.entries)) {
			if (get_bool_string(item.raw.attributes.Visible)) {
				if (!item.source || have_source.indexOf(item.source) !== -1)
					this.getCategory(item.raw.attributes.Category ?? "General").entries.push(item);
			}
		}
		this.categories = this.categories.filter(i => i.entries.length);
	}

	private getCategory(name: string) {
		let cat = this.categories.find(c => c.name === name);
		if (!cat) {
			cat = {
				name: 		name,
				display: 	name,
				entries: 	[]
			};
			this.categories.push(cat);
		}
		return cat;
	}

	public getEntry(name: string) {
		for (const cat of this.categories)
			for (const entry of cat.entries)
				if (entry.raw.attributes.Name === name)
					return entry;
	}

	public empty() {
		return !this.categories.length;
	}

	public toHTML() {
		return <>
			<h1>{this.display}</h1>
			{this.categories.map(cat=>
			<div class="settings-group" id={this.name+'-'+cat.name}>
				<h2>{cat.display}</h2>
				{cat.entries.map(item => {
					const attributes = item.raw.attributes;
					const id = make_variable(item.source, attributes.Name);
					return <div class="setting-item">
						<Label id={id} display={(attributes.DisplayName ?? attributes.Name) + ':'}/>
						<InputItem id={id} item={item.raw}/>
					</div>;
				}).join("\n")}
			</div>
			).join("\n")}
		</>;
	}
}

async function getSchemas(pp: MsBuild.Items, have_source: string[], file_source: string) : Promise<Schema[]> {
	const rules	= await Promise.all(pp.entries
		.filter(i => has_context(i.data.source, 'Project'))
		.map(i => SchemaFile.read(i.data.fullPath))
	);
	const files	= Object.values(rules.reduce((acc, i) => {
		if (i) {
			const name = i.attributes.Name;
			if (acc[name])
				acc[name].combine(i);
			else
				acc[name] = i;
		}
		return acc;
	}, {} as Record<string, SchemaFile>));
/*
	const t1 = files.map(schema => new Schema(schema, have_source));
	const t2 = t1.filter(i => !i.empty());
	t2.forEach(i => {
		if (file_source)
			i.categories.forEach(cat => cat.entries.forEach(e => {if (e.source == '{}{AnyType}') e.source = file_source; }));
	});

	const schemas = t2;
*/

	const schemas = Object.values(
		files.map(schema => new Schema(schema, have_source))
		.filter(i => !i.empty())
		.reduce((acc, i) => {
			if (file_source)
				i.categories.forEach(cat => cat.entries.forEach(e => {if (e.source === '{}{AnyType}') e.source = file_source; }));

			const other = acc[i.display];
			if (other)
				other.categories = [...other.categories, ...i.categories];
			else
				acc[i.display] = i;
			return acc;
		}, {} as Record<string, Schema>)
	);

	schemas.sort((a, b) => a.order - b.order);
	return schemas;
}

//-----------------------------------------------------------------------------
//	messages
//-----------------------------------------------------------------------------

function setItems(panel: vscode.WebviewPanel, values: Record<string, any>) {
	panel.webview.postMessage({command:'set', values: values});
}

function id_selector(item: string) {
	return '#'+item.replace(/\./g, '\\.').replace(/ /g, '\\ ');
}

function by_id(item: string) {
	return id_selector(item);
}

function addClass(panel: vscode.WebviewPanel, selector: string, clss: string, enable:boolean, parent:number = 0) {
	panel.webview.postMessage({
		command:	'add_class',
		selector:	selector,
		class:		clss,
		enable: 	enable,
		parent: 	parent
	});
}

function setAttribute(panel: vscode.WebviewPanel, selector: string, attribute: string, value:any, parent:number = 0) {
	panel.webview.postMessage({
		command:	'set_attribute',
		selector:	selector,
		attribute: 	attribute,
		value:		value,
		parent: 	parent
	});
}
//-----------------------------------------------------------------------------
//	evaluate
//-----------------------------------------------------------------------------

class Result {
	constructor(public value: string, public loc?: xml.Element, public extra?: any) {}
	public source() : string|undefined { return this.loc?.firstText(); }
}
type Source 	= Record<string, Result>;
type Sources 	= Record<string, Source>;

function combineSources(dest: Sources, srce: Sources) {
	for (const j in srce) {
		if (!dest[j]) {
			dest[j] = srce[j];
		
		} else {
			const s = srce[j];
			const d = dest[j];
			for (const p in d) {
				if (s[p].value && s[p].value !== d[p].value) {
					d[p].value = "multiple values";
					d[p].loc = undefined;
				}
			}
			for (const p in s) {
				if (!d[p])
					d[p] = s[p];
			}
		}
	}
}

async function combinedSources(project: MsBuildProjectBase, configurations: Properties[], file?: string) : Promise<Sources> {
	const sources: Sources = {};
	for (const config of configurations) {
		const [props, modified]		= await project.evaluateProps(config);

		const sources2	= Object.fromEntries(await utils.asyncMap(Object.values(project.msbuild.items), async items => {
			const entry 	= file ? items.getEntry(file) : undefined;
			const result	= await items.evaluate(props, entry);
			const use_loc	= !file || entry;
			return [items.name, Object.fromEntries(Object.entries(result[0]).map(([k, v]) => [k, new Result(v, use_loc ? result[1][k] : undefined, 0)]))];
		}));

		sources2['']	= insensitive.Record(Object.fromEntries(Object.entries(props.properties).map(([k, v]) => [k, new Result(v, modified[k], 0)])));
		combineSources(sources, sources2);
	}
	return sources;
}

function makeCondition(platforms:string[], configurations:string[]) {
	const all = platforms.reduce((a, i) => [...a, ...configurations.map(j => `${j}|${i}`)], [] as string[]);
	return all.map(i=>`'$(Configuration)|$(Platform)'=='${i}'`).join(" Or ");
}

function isLocal(project: MsBuildProjectBase, result: Result|undefined) : boolean {
	return (result && result.loc && project.isLocal(result.loc)) ?? false;
}


//-----------------------------------------------------------------------------
//	ProjectSettings
//-----------------------------------------------------------------------------

async function ProjectSettings(panel: vscode.WebviewPanel, title: string, config: Properties, project: MsBuildProjectBase, file?: string) {
	let settings	: Record<string, Result>	= {};
	let configs		: Record<string, any>[]		= [];
	const modifications: Record<string, string> = {};

	//currently checked
	let	platforms 		= [config.Platform];
	let configurations 	= [config.Configuration];

	const file_source	= (file && Object.keys(project.msbuild.items).find(name => !!project.msbuild.items[name].getEntry(file))) ?? '';
	const have_source	= file ? ['{}{AnyType}', file_source] : Object.keys(project.msbuild.items);
	const pp			= project.msbuild.items["PropertyPageSchema"];
	const schemas 		= pp ? await getSchemas(pp, have_source, file_source) : [] as Schema[];
	const schema_by_id	= {} as Record<string, SchemaEntry>;
	for (const schema of schemas) {
		for (const cat of schema.categories) {
			for (const entry of cat.entries)
				schema_by_id[make_variable(entry.source, entry.raw.attributes.Name)] = entry;
		}
	}

	function setAll() {
		const all 		= schemas.map(i => i.categories.map(cat => cat.entries.map(e => make_variable(e.source, e.raw.attributes.Name)))).flat().flat();
		const values	= all.reduce((acc, i) => {acc[i] = ['<inherit>',false]; acc[i+'.resolved'] = ''; return acc;}, {} as Record<string, any>);
		Object.entries(settings).forEach(([id, result]) => {
			values[id] = [result.source() ?? '', isLocal(project, result)];
			values[id+'.resolved'] = result.value;
		});
		setItems(panel, values);
	}
	function init() {
		panel.webview.postMessage({
			command:'splice',
			item:'configuration',
			source:1,
			dest:2,
			values:Object.entries(project.configurationList()).map(([i, v]) => ({id: v, name: v}))
		});
		panel.webview.postMessage({
			command:'splice',
			item:'platform',
			source:1,
			dest:2,
			values:Object.entries(project.platformList()).map(([i, v]) => ({id: v, name: v}))
		});
		setItems(panel, {
			[`configuration.${config.Configuration}.check`]: true,
			[`platform.${config.Platform}.check`]: true
		});
	}
	function update() {
		if ('ProjectConfiguration' in project.msbuild.items) {
			configs	= project.msbuild.items.ProjectConfiguration.entries.filter(i => 
					(configurations.length == 0 || configurations.indexOf(i.data.Configuration) !== -1)
				&&	(platforms.length == 0 || platforms.indexOf(i.data.Platform) !== -1)
				).map(i => utils.filterObject(i.data, ([_, v]) => typeof v == 'string')) || [];
		} else {
			configs	= Object.values(project.configuration).filter(i => 
					(configurations.length == 0 || configurations.indexOf(i.Configuration) !== -1)
				&&	(platforms.length == 0 || platforms.indexOf(i.Platform) !== -1)
				) || [];
		}

		addClass(panel, "div.settings-content", 'invalid', configs.length == 0, 0);

		combinedSources(project, configs, file).then(resolved => {
			settings = {};
			for (const schema of schemas) {
				for (const cat of schema.categories) {
					for (const entry of cat.entries) {
						const source	= entry.source;
						const name		= entry.raw.attributes.Name;
						const result	= resolved[source]?.[name];
						if (result)
							settings[make_variable(source, name)] = result;
					}
				}
			}

			if (panel.visible)
				setAll();
		});
	}

	function Modify(id: string, value: string, revert = false) {
		const [source, name] = split_variable(id);
		const condition = makeCondition(platforms, configurations);
		return project.addSetting(source, name, value, condition, schema_by_id[id].persist, revert);
	}
	
	disposeDidChangeViewState = panel.onDidChangeViewState(e => {
		if (e.webviewPanel.visible) {
			setAll();
			for (const i in modifications)
				addClass(panel, by_id(i), 'modified', true, 1);
		}
	}, null, Extension.context.subscriptions);

	// Handle messages from the webview
	disposeDidReceiveMessage = panel.webview.onDidReceiveMessage(async message => {
		switch (message.command) {
			case 'configuration':
				configurations = message.value;
				update();
				break;

			case 'platform':
				platforms 	= message.value;
				update();
				break;

			case 'change': {
				console.log(`change: id=${message.id} value=${message.value}`);
				if (!modifications[message.id]) {
					addClass(panel, by_id(message.id), 'modified', true, 1);
					modifications[message.id] = isLocal(project, settings[message.id]) ? settings[message.id]?.source() ?? '' : '<inherit>';	// save original value
				}
				const loc = Modify(message.id, message.value);
				if (settings[message.id])
					settings[message.id].loc = loc;

				const [source, name] = split_variable(message.id);
				const resolved	= await combinedSources(project, configs, file);
				//const props 	= new PropertyContext(Object.fromEntries(Object.entries(resolved['']).map(([k, v]) => [k, v.value])));
				setItems(panel, {[message.id + '.resolved']: resolved[source][name].value ?? ''});
				break;
			}
			case 'revert': {
				const loc = Modify(message.id, modifications[message.id], true);
				if (settings[message.id])
					settings[message.id].loc = loc;

				delete modifications[message.id];
				const [source, name] = split_variable(message.id);
				const resolved	= await combinedSources(project, configs, file);
				setItems(panel, {
					[(isLocal(project, resolved[source][name]) ? '' : '?') + message.id]: resolved[source][name].source() ?? '',
					[message.id + '.resolved']: resolved[source][name].value ?? ''
				});
				break;
			}
		}
	}, null, Extension.context.subscriptions);

	const 	getUri = (name: string) => panel.webview.asWebviewUri(Uri.joinPath(Extension.context.extensionUri, 'assets', name));
	panel.webview.html = '';
	panel.webview.html = `<!DOCTYPE html>` + 
<html lang="en">
<head>
	<meta charset="UTF-8"/>
	<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
	<link rel="stylesheet" href={getUri("settings.css")}/>
</head><body>

<div style="display:flex">

	<div class="settings-sidebar">
	<div style="display:flex">
		<div id="configuration" style="flex:1"><Label id="Configuration" display="Configuration"/>
			<div hidden id="configuration.$(id)">
				<div><input type="checkbox" id="configuration.$(id).check" name="$(id)"><span contenteditable name="configuration.$(id)">$(name)</span></input></div>
			</div>
			{/*<CheckList values={project.configurationList()} value = {config.Configuration}/>*/}
		</div>
		<div id="platform" style="flex:1"><Label id="Platform" display="Platform"/>
			<div hidden id="platform.$(id)">
				<div><input type="checkbox" id="platform.$(id).check" name="$(id)"><span contenteditable name="platform.$(id)">$(name)</span></input></div>
			</div>
			{/*<CheckList values={project.platformList()} value={config.Platform}/>*/}
		</div>
	</div>

	<ul id = "sidebar">
		{schemas.map(schema => <li>
			<span class="caret">{schema.display}
			<ul>{schema.categories.map(cat => <li data-target={schema.name+'-'+cat.name}>{cat.display}</li>).join("\n")}</ul>
			</span>
		</li>)}
	</ul>
	</div>

	<div class="settings-content">{schemas.map((schema, i) => schema.toHTML())}</div>

</div>

<script src={getUri("settings.js")}></script>

</body></html>;

	init();
	update();
}

//-----------------------------------------------------------------------------
//	SolutionSettings
//-----------------------------------------------------------------------------

function new_name(list:string[], id:number) {
	const name = list[id].split('(')[0] + '(';
	let index = 0;
	for (const i of list) {
		if (i && i.startsWith(name))
			index = Math.max(index, parseInt(i.substring(name.length)));
	}
	return `${name}${index+1})`;
}

function SolutionSettings(panel: vscode.WebviewPanel, title: string, config: Properties, solution: Solution) {
	const projects 		= Object.values(solution.projects).filter(p => Object.keys(p.configuration).length);
	const lists	: Record<string, string[]> = {
		configuration:	solution.configurationList(),
		platform:		solution.platformList(),
	};

	//currently checked
	let configurations 	= [lists.configuration.indexOf(config.Configuration)];
	let	platforms 		= [lists.platform.indexOf(config.Platform)];

	function init() {
		panel.webview.postMessage({
			command:'splice',
			item:'configuration',
			source:1,
			dest:2,
			values:Object.entries(lists.configuration).map(([i, v]) => ({id: i, name: v}))
		});
		panel.webview.postMessage({
			command:'splice',
			item:'platform',
			source:1,
			dest:2,
			values:Object.entries(lists.platform).map(([i, v]) => ({id: i, name: v}))
		});
		setItems(panel, {
			[`configuration.${lists.configuration.indexOf(config.Configuration)}.check`]: true,
			[`platform.${lists.platform.indexOf(config.Platform)}.check`]: true
		});
	}
	function update() {
		const c = [configurations[0], platforms[0]].join('|');

		setItems(panel, {'solution.startup': solution.startup?.guid});
		setItems(panel, {'debug_include': solution.debug_include.join(';')});
		setItems(panel, {'debug_exclude': solution.debug_exclude.join(';')});

		setItems(panel,
			projects.map(p => {
				const config = p.configuration[c];
				return {
					[`${p.name}.config`]: 	config?.Configuration,
					[`${p.name}.plat`]:		config?.Platform,
					[`${p.name}.build`]:	config?.build ? 'true' : '',
					[`${p.name}.deploy`]:	config?.deploy ? 'true' : '',
				};
			}).reduce((acc, i) => ({...acc, ...i}), {})
		);

		projects.forEach(p => {
			const config = p.configuration[c];
			addClass(panel, by_id(`${p.name}.config`), 'invalid', !p.validConfig(config), 1);
		});
	}

	disposeDidChangeViewState = panel.onDidChangeViewState(e => {
		const panel = e.webviewPanel;
		if (panel.visible) {
			init();
			update();
		}
	}, null, Extension.context.subscriptions);

	// Handle messages from the webview
	disposeDidReceiveMessage = panel.webview.onDidReceiveMessage(async message => {
		switch (message.command) {
			case 'configuration':
				configurations = message.value;
				update();
				break;

			case 'platform':
				platforms = message.value;
				update();
				break;

			case 'click': {
				vscode.window.showErrorMessage(`clicked ${message.id}`);
				const [type, id, action] = message.id.split('.');
				const list = lists[type];

				if (action === 'delete') {
					panel.webview.postMessage({command:'delete', selector:by_id(`${type}.${id}`)});
					delete list[+id];

				} else if (action === 'duplicate') {
					const name = new_name(list, id);
					const id2	= list.length;
					panel.webview.postMessage({command:'splice', item:type, source:1, dest:list.length + 2, values:[{id: id2, name:name}]});
					list.push(name);

					if (type === 'configuration') {
						for (const i in lists.platform) {
							const key0 = `${id}|${i}`;
							const key1 = `${id2}|${i}`;
							projects.forEach(p => p.configuration[key1] = p.configuration[key0]);
						}
					} else {
						for (const i in lists.configuration) {
							const key0 = `${i}|${id}`;
							const key1 = `${i}|${id2}`;
							projects.forEach(p => p.configuration[key1] = p.configuration[key0]);
						}
					}
				}
				break;
			}
			case 'change': {
				console.log(`change: item=${message.id} value=${message.value}`);
				const [proj, action] = message.id.split('.');

				if (proj === 'solution') {
					switch (action) {
						case 'startup': solution.startup = message.value; break;
						default:
					}
					
				} else if (proj in lists) {
					const list = lists[proj];
					const dup = list.find(i => i === message.value);
					addClass(panel, by_id(message.id), 'invalid', !!dup);
					if (!dup)
						list[+action] = message.value;

				} else {
					const project = projects.find(p => p.name === proj);
					const c 	= [configurations[0], platforms[0]].join('|');
					const dest 	= project?.configuration[c];
					if (dest) {
						switch (action) {
							case 'deploy':	dest.deploy			= message.value; break;
							case 'build':	dest.build			= message.value; break;
							case 'config':	dest.Configuration	= message.value; break;
							case 'plat':	dest.Platform 		= message.value; break;
						}
						const valid = project.validConfig(dest);
						addClass(panel, by_id(message.id), 'invalid', !valid, 1);
						if (valid)
							solution.dirty();
					} else {
						console.log("something went wrong");
					}
				}
				break;
			}
		}
	}, null, Extension.context.subscriptions);

	const 	getUri = (name: string) => panel.webview.asWebviewUri(Uri.joinPath(Extension.context.extensionUri, 'assets', name));
	panel.webview.html = '';
	panel.webview.html = `<!DOCTYPE html>`+
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<link rel="stylesheet" href={getUri("settings.css")}/>
</head>
<body>

<div style="display:flex">

<div class="settings-sidebar">

<div style="display:flex">
	<div id="configuration" style="flex:1">
		<Label id="Configuration" display="Configuration"/>
		<div hidden id="configuration.$(id)">
			<ClickableIcon code={codicons.trash} id="configuration.$(id).delete"/>
			<ClickableIcon code={codicons.add} id="configuration.$(id).duplicate"/>
			<input type="checkbox" name="$(id)" id="configuration.$(id).check"><span contenteditable name="configuration.$(id)">$(name)</span></input>
		</div>
	</div>
	<div id="platform" style="flex:1">
		<Label id="Platform" display="Platform"/>
		<div hidden id="platform.$(id)">
			<ClickableIcon code={codicons.trash} id="platform.$(id).delete"/>
			<ClickableIcon code={codicons.add} id="platform.$(id).duplicate"/>
			<input type="checkbox" name="$(id)" id="platform.$(id).check"><span contenteditable name="platform.$(id)">$(name)</span></input>
		</div>
	</div>
</div>
<ul id = "sidebar">
</ul>
</div>

<div class="settings-content">

<h1>Startup Project</h1>
<div class="setting-item">
	<DropDownList id= "solution.startup" values={projects.map(p => ({value: p.guid, display: p.name}))}/>
</div>

<h1>Debug Source Files</h1>
<h2>Include Directories</h2>
<div class="setting-item">
	<textarea id='debug_include' rows="1" style="flex:3"></textarea>
</div>
<h2>Exclude Files</h2>
<div class="setting-item">
	<textarea id='debug_exclude' rows="1" style="flex:3"></textarea>
</div>

<h1>Configurations</h1>

<h2><div class="setting-item">
	<span>Project</span><span>Configuration</span><span>Platform</span><span style='text-align: center'>Build</span><span style='text-align: center'>Deploy</span>
</div></h2>

{projects.map(p => <div class="setting-item">
	<span>{p.name}</span>
	<DropDownList id = {p.name+'.config'}	values = {p.configurationList().map(e => ({value: e, display: e}))}/>
	<DropDownList id = {p.name+'.plat'}	values = {p.platformList().map(e => ({value: e, display: e}))}/>
	<input type="checkbox" id={p.name+'.build'}></input>
	<input type="checkbox" id={p.name+'.deploy'}></input>
</div>)}

</div>
</div>

<script src={getUri("settings.js")}></script>

</body></html>;

	init();
	update();
}

export function exists() {
	return !!the_panel;
}

export function Set(title: string, config: Properties, project: MsBuildProjectBase|Solution, file?: string) {
	let panel:		vscode.WebviewPanel;

	if (!the_panel) {
		the_panel = panel = vscode.window.createWebviewPanel('settings', title, vscode.ViewColumn.One, {enableScripts: true});
		the_panel.onDidDispose(() => {
			the_panel = undefined;
		}, null, Extension.context.subscriptions);
	} else {
		disposeDidChangeViewState.dispose();
		disposeDidReceiveMessage.dispose();

		panel = the_panel;
		panel.title = title;

		panel.reveal(panel.viewColumn);
	}

	return project instanceof Solution
		? SolutionSettings(panel, title, config, project)
		: ProjectSettings(panel, title, config, project, file);
}
