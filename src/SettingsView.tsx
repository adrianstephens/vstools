import * as vscode from "vscode";
import * as xml from "./xml";
import {Extension} from "./extension";
import {Uri} from "vscode";
import {Solution} from "./Solution";
import {Project, Configuration, Properties} from "./Project";
import {MsBuildProject, SchemaFile, SchemaEntry, Source, Sources} from "./MsBuildProject";
import {filterObject, mapObject} from "./utils";
import {jsx, fragment} from "./jsx";

function split_variable(name: string) {
	const parts = name.split('.');
	return parts.length > 1 ? parts : ['', name];
}
function make_variable(space:string, name: string) {
	return space ? `${space}.${name}` : name;
}

type Category = {
	name: 		string,
	display: 	string,
	entries: 	SchemaEntry[];
};

class Schema {
	name: 		string;
	display: 	string;
	order: 		number;
	categories : Category[] = [];

	constructor(rules: SchemaFile, have_source: string[]) {
		this.name 		= rules.attributes.Name;
		this.display 	= rules.attributes.DisplayName;
		this.order 		= +(rules.attributes.Order??0);

		for (const cat in rules.categories)
			this.categories.push({name: cat, display: rules.categories[cat], entries: []});

		//sort into categories
		for (const item of Object.values(rules.entries)) {
			if (item.raw.attributes.Visible?.toString()?.toLowerCase() != "false") {
				if (!item.source || have_source.indexOf(item.source) !== -1)
					this.getCategory(item.raw.attributes.Category ?? "General").entries.push(item);
			}
		}
		this.categories = this.categories.filter(i => i.entries.length);
	}

	private getCategory(name: string) {
		const cat = this.categories.find(c => c.name === name);
		if (cat)
			return cat;
		this.categories.push({
			name: 		name,
			display: 	name,
			entries: 	[]
		});
		return this.categories[this.categories.length - 1];
	}

	public getEntry(name: string) {
		for (const cat of this.categories)
			for (const entry of cat.entries)
				if (entry.raw.attributes.Name === name)
					return entry;
		return null;
	}

	public empty() {
		return !this.categories.length;
	}
}

//-----------------------------------------------------------------------------
//	HTML helpers
//-----------------------------------------------------------------------------

function icon(code:number) {
	return <span class="codicon">&#x{code.toString(16)};</span>;
}
function ClickableIcon({code, id} : {code:number, id:string}) {
	return <button class="codicon" id={id}>&#x{code.toString(16)};</button>;
}
function Button({text, id} : {text:string, id:string}) {
	return <button id={id}>{text}</button>;
}

function Label(id: string, display: string) {
	return <label for={id}>{display}</label>;
}

interface DropDownEntry {
	value:		string,
	display:	string,
}

function DropDownList(name: string, values: DropDownEntry[], value?: string) {
	return <select id={name} name={name} className="inherit">
		{value ? <option value="">{value}</option> : ''}
		{values.map(i => <option value={i.value}>{i.display}</option>)}
	</select>;
}

function CheckList(values: string[], value?: string) {
	return <>{values.map(name =>
		<div><input type="checkbox" id={name} name={name} checked={name == value}><label for={name}>{name}</label></input></div>
	)}</>;
}

function FormItem1(name:string, item: xml.Element) :string {
	switch (item.name) {
		case "StringProperty":
		case "DynamicEnumProperty":
			return <>
				<input type="text" id={name} name={name} placeholder="&lt;inherit default&gt;"/>
				<input type="text" id={name+'.resolved'} readonly/>
			</>;

		case "StringListProperty":
			return <>
				<textarea id={name} name={name} rows="1" placeholder="&lt;inherit default&gt;"></textarea>
				<textarea id={name+'.resolved'} rows="1" readonly></textarea>
			</>;
			//return `
			//<div id="${name}" class="multi">
			//	<div>
			//		<input type="text" placeholder="&lt;inherit default&gt;">
			//		<button class="codicon">&#xea81;
			//	</div>
			//</div>`;
		case "BoolProperty":
			return DropDownList(name, [
				{value: item.attributes.Switch ? '' : 'false', display:"No"},
				{value: item.attributes.Switch ? '/' + item.attributes.Switch : 'true', display: "Yes"}
			], '&lt;inherit&gt;')
			+ <input type="text" id={name+'.resolved'} readonly={true}/>;
/*
			return `
	<input type="checkbox" id="${name}" name="${name}">
	<input type="checkbox" id="${name}.resolved" readonly>
`;
*/
		case "EnumProperty":
			return DropDownList(name, item.children.filter(e => xml.isElement(e)).map(e => ({value: e.attributes.Name, display: e.attributes.DisplayName})), '&lt;inherit&gt;')
			+ <input type="text" id={name+'.resolved'} readonly={true}/>;
		default:
			return "";
	}
}

function FormItem(item: xml.Element, source: string) :string {
	const id = make_variable(source, item.attributes.Name);
	return <div class="setting-item">{Label(id, item.attributes.DisplayName + ':') + FormItem1(id, item)}</div>;
}

function Form(name:string, display_name:string, categories: Category[]) {
	return <form id={name}>
		<h1>{display_name}</h1>
		{categories.map(cat=>
		<div class="settings-group" id={name+'-'+cat.name}>
			<h2>{cat.display}</h2>
			{cat.entries.map(item => FormItem(item.raw, item.source)).join("\n")}
		</div>
		).join("\n")}
	</form>;
}


//-----------------------------------------------------------------------------
//	messages
//-----------------------------------------------------------------------------

function setItems(panel: vscode.WebviewPanel, values: Properties) {
	panel.webview.postMessage({command:'set', values: values});
}

function clearForm(panel: vscode.WebviewPanel, form: string) {
	panel.webview.postMessage({command:'clear_form', form: form});
}

function fix_selector(item: string) {
	return '#'+item.replace(/\./g, '\\.').replace(/ /g, '\\ ');
}

function item(item: string) {
	return fix_selector(item);
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

function getConfigurations(project: MsBuildProject|Solution, configurations: string[], platforms: string[]) {
	if (project instanceof Solution) {
		return project.configurations.filter(i => 
			(configurations.length == 0 || configurations.indexOf(i.Configuration) !== -1)
		&&	(platforms.length == 0 || platforms.indexOf(i.Platform) !== -1)
		).map(i => i.properties);
	} else {
		return project.items.ProjectConfiguration.entries.filter(i => 
			(configurations.length == 0 || configurations.indexOf(i.data.Configuration) !== -1)
		&&	(platforms.length == 0 || platforms.indexOf(i.data.Platform) !== -1)
		).map(i => filterObject(i.data, ([_, v]) => typeof v == 'string'));
	}
}

async function combinedSources(project: MsBuildProject, configurations: Properties[], final:boolean, file?: string) : Promise<Sources> {
	const sources: Sources = {};
	for (const config of configurations)
		combineSources(sources, await project.evaluate(config, final, file));
	return sources;
}

function makeCondition(platforms:string[], configurations:string[]) {
	const all = platforms.reduce((a, i) => [...a, ...configurations.map(j => `${j}|${i}`)], [] as string[]);
	return all.map(i=>`'$(Configuration)|$(Platform)'=='${i}'`).join(" Or ");
}

//-----------------------------------------------------------------------------
//	View
//-----------------------------------------------------------------------------

let the_panel : vscode.WebviewPanel | undefined;
let disposeDidChangeViewState:	vscode.Disposable;
let disposeDidReceiveMessage:	vscode.Disposable;

function ProjectSettings(panel: vscode.WebviewPanel, title: string, config: Configuration, project: MsBuildProject, file?: string) {
	let settings:	Source = {};
	let	platforms 		= [config.Platform];
	let configurations 	= [config.Configuration];
	let configs			= getConfigurations(project, configurations, platforms);
	const modifications: Record<string, string> = {};
	
	const file_source = (file && Object.keys(project.items).find(name => !!project.items[name].getEntry(file))) ?? '';
	const have_source = file ? ['{}{AnyType}', file_source] : Object.keys(project.items);

	let schemas = project.schemas.map(schema => new Schema(schema, have_source)).filter(i => !i.empty());

	schemas = Object.entries(schemas.reduce((acc, i) => {
		if (file_source)
			i.categories.forEach(cat => cat.entries.forEach(e => {if (e.source == '{}{AnyType}') e.source = file_source; }));

		const other = acc[i.display];
		if (other)
			other.categories = [...other.categories, ...i.categories];
		else
			acc[i.display] = i;
		return acc;
	}, {} as Record<string, Schema>)).map(([k, v]) => v);

	schemas.sort((a, b) => a.order - b.order);

	const schema_by_id = {} as Record<string, SchemaEntry>;
	for (const schema of schemas) {
		for (const cat of schema.categories) {
			for (const entry of cat.entries)
				schema_by_id[make_variable(entry.source, entry.raw.attributes.Name)] = entry;
		}
	}

	function update() {
		if (schemas.length)
			addClass(panel, item(schemas[0].name), 'invalid', configs.length == 0, 1);

		combinedSources(project, configs, true, file).then(resolved => {
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

			if (panel.visible) {
				for (const i of schemas)
					clearForm(panel, i.name);

				setItems(panel, mapObject(settings, ([id, result]) => [(project.isLocal(result) ? '' : '?') + id, result.source() ?? '']));
				setItems(panel, mapObject(settings, ([id, result]) => [id + '.resolved', result.value]));
			}
		});

	}

	function Modify(id: string, value: string, revert = false) {
		const [source, name] = split_variable(id);
		const condition = makeCondition(platforms, configurations);
		return project.addSetting(source, name, value, condition, schema_by_id[id].user, revert);
	}
	
	disposeDidChangeViewState = panel.onDidChangeViewState(e => {
		const panel = e.webviewPanel;
		if (panel.visible) {
			setItems(panel, mapObject(settings, ([id, result]) => [(project.isLocal(result) ? '' : '?') + id, result.source() ?? '']));
			setItems(panel, mapObject(settings, ([id, result]) => [id + '.resolved', result.value]));
		}
	}, null, Extension.context.subscriptions);

	// Handle messages from the webview
	disposeDidReceiveMessage = panel.webview.onDidReceiveMessage(async message => {
		switch (message.command) {
			case 'save':
				for (const i in project.schemas) {
					if (project.schemas[i].attributes.Name === message.form) {
						//values[i] = message.values;
						break;
					}
				}
				break;

			case 'change': {
				console.log(`change: form=${message.form} item=${message.item} value=${message.value}`);
				if (!modifications[message.item]) {
					addClass(panel, item(message.item), 'modified', true, 1);
					modifications[message.item] = project.isLocal(settings[message.item]) ? settings[message.item]?.source() ?? '' : '<inherit>';	// save original value
				}
				const loc = Modify(message.item, message.value);
				settings[message.item].loc = loc;

				const [source, name] = split_variable(message.item);
				const resolved	= await combinedSources(project, configs, true, file);
				//const props 	= new PropertyContext(Object.fromEntries(Object.entries(resolved['']).map(([k, v]) => [k, v.value])));
				setItems(panel, {[message.item + '.resolved']: resolved[source][name].value ?? ''});
				break;
			}
			case 'configuration':
				configs	= getConfigurations(project, configurations = message.value, platforms);
				update();
				break;

			case 'platform':
				configs	= getConfigurations(project, configurations, platforms = message.value);
				update();
				break;

			case 'revert': {
				const loc = Modify(message.item, modifications[message.item], true);
				settings[message.item].loc = loc;

				delete modifications[message.item];
				const [source, name] = split_variable(message.item);
				const resolved	= await combinedSources(project, configs, true, file);
				setItems(panel, {
					[(project.isLocal(resolved[source][name]) ? '' : '?') + message.item]: resolved[source][name].source() ?? '',
					[message.item + '.resolved']: resolved[source][name].value ?? ''
				});

				break;
			}
			case 'alert':
				vscode.window.showErrorMessage(message.text);
				return;
		}
	}, null, Extension.context.subscriptions);

	const 	getUri = (name: string) => panel.webview.asWebviewUri(Uri.joinPath(Extension.context.extensionUri, 'media', name));
	panel.webview.html = `<!DOCTYPE html>` + 
<html lang="en">
<head>
	<meta charset="UTF-8"/>
	<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
	<link rel="stylesheet" href={getUri("styles.css")}/>
</head><body>

<div style="display:flex">

	<div class="settings-sidebar">
	<div style="display:flex">
		<div id="configuration" style="flex:1">{Label("Configuration", "Configuration") + CheckList(project.configurationList(), config.Configuration)}</div>
		<div id="platform" style="flex:1">{Label("Platform", "Platform") + CheckList(project.platformList(), config.Platform)}</div>
	</div>

	<ul id = "sidebar">
		{schemas.map(schema => <li>
			<span class="caret">{schema.display}
			<ul class="nested">{schema.categories.map(cat => <li data-target={schema.name+'-'+cat.name}>{cat.display}</li>).join("\n")}</ul>
			</span>
		</li>)}
	</ul>
	</div>

	<div class="settings-content">{schemas.map((schema, i) => Form(schema.name, schema.display, schema.categories))}</div>

</div>

<script src={getUri("scripts.js")}></script>

</body></html>;
	update();
}

function getSolutionConfigurations(solution: Solution, configurations: string[], platforms: string[]) {
	return solution.configurations.filter(i => 
		(configurations.length == 0 || configurations.indexOf(i.Configuration) !== -1)
	&&	(platforms.length == 0 || platforms.indexOf(i.Platform) !== -1)
	).map(i => i.properties);
}

function SolutionSettings(panel: vscode.WebviewPanel, title: string, config: Configuration, solution: Solution) {
	const projects 		= Object.values(solution.projects).filter(p => Object.keys(p.configuration).length);

	const configurationList	= solution.configurationList();
	const platformList 		= solution.platformList();

	let	platforms 			= [config.Platform];
	let configurations 		= [config.Configuration];
	let configs				= getSolutionConfigurations(solution, configurations, platforms);
	
	function update() {
		const c = new Configuration(configurations[0], platforms[0]).fullName;

		setItems(panel, {'solution.startup': solution.config.StartupProject});
		setItems(panel, {'debug_include': solution.debug_include.join(';')});
		setItems(panel, {'debug_exclude': solution.debug_exclude.join(';')});

		setItems(panel,
			projects.map(p => {
				const config = p.configuration[c];
				return {
					[`${p.name}.config`]: 	config?.[0].Configuration,
					[`${p.name}.plat`]:		config?.[0].Platform,
					[`${p.name}.build`]:	config?.[1] ? 'true' : '',
					[`${p.name}.deploy`]:	'',
				};
			}).reduce((acc, i) => ({...acc, ...i}), {})
		);
	}

	disposeDidChangeViewState = panel.onDidChangeViewState(e => {
		const panel = e.webviewPanel;
		if (panel.visible) {
			//restore
		}
	}, null, Extension.context.subscriptions);

	// Handle messages from the webview
	disposeDidReceiveMessage = panel.webview.onDidReceiveMessage(async message => {
		switch (message.command) {
			case 'configuration':
				configs	= getSolutionConfigurations(solution, configurations = message.value, platforms);
				update();
				break;

			case 'platform':
				configs	= getSolutionConfigurations(solution, configurations, platforms = message.value);
				update();
				break;

			case 'click': {
				vscode.window.showErrorMessage(`clicked ${message.id}`);
				const [type, name, action] = message.id.split('.');
				const list = type === 'configuration' ? configurationList : platformList;
				const index = list.indexOf(name);

				if (action === 'delete') {
					addClass(panel, item(`${type}.${name}`), 'hidden', true);
					list.splice(index, 1);
				//} else if (action === 'rename') {
				//	setAttribute(panel, item(`${type}.${name}`)+' span', 'contenteditable', true);
				}
				break;
			}
			case 'change': {
				console.log(`change: item=${message.item} value=${message.value}`);
				break;
			}
		}
	}, null, Extension.context.subscriptions);

//	{CheckList2(configurationList, config.Configuration)}</div>
//<div id="platform" style="flex:1">{Label("Platform", "Platform")}{CheckList2(platformList, config.Platform)}</div>

	const 	getUri = (name: string) => panel.webview.asWebviewUri(Uri.joinPath(Extension.context.extensionUri, 'media', name));
	panel.webview.html = `<!DOCTYPE html>`+
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<link rel="stylesheet" href={getUri("styles.css")}/>
</head>
<body>

<div style="display:flex">

<div class="settings-sidebar">

<div style="display:flex">
	<div id="configuration" style="flex:1">
		{Label("Configuration", "Configuration")}
		<div hidden id="configuration.$(name)">
			<ClickableIcon code={0xea81} id="configuration.$(name).delete"/>
			{/*<ClickableIcon code={0xeb7e} id="configuration.$(name).rename"/>*/}
			<input type="checkbox"><span contenteditable name="$(name)">$(name)</span></input>
		</div>
		<div>
			<ClickableIcon code={0xea81} id="configuration.$(name).delete"/>
			<input type="checkbox"><span contenteditable>{"&lt;new&gt;"}</span></input>
		</div>
	</div>
	<div id="platform" style="flex:1">
		{Label("Platform", "Platform")}
		<div hidden id="platform.$(name)">
			<ClickableIcon code={0xea81} id="platform.$(name).delete"/>
			{/*<ClickableIcon code={0xeb7e} id="platform.$(name).rename"/>*/}
			<input type="checkbox"><span contenteditable name="$(name)">$(name)</span></input>
		</div>
		<div>
			<Button text="New" id="platform.add"/>
		</div>
	</div>
</div>
<ul id = "sidebar">
</ul>
</div>

<div class="settings-content">

<h1>Startup Project</h1>
<div class="setting-item">
{DropDownList("solution.startup", projects.map(p => ({value: p.guid, display: p.name})))}
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
<div class="codicon">&#xea81;</div>

<h2><div class="setting-item">
	<span>Project</span><span>Configuration</span><span>Platform</span><span style='text-align: center'>Build</span><span style='text-align: center'>Deploy</span>
</div></h2>

{projects.map(p => <div class="setting-item">
	<span>{p.name}</span>
	{DropDownList(p.name+'.config', p.configurationList().map(e => ({value: e, display: e})))}
	{DropDownList(p.name+'.plat', p.platformList().map(e => ({value: e, display: e})))}
	<input type="checkbox" id={p.name+'.build'}></input>
	<input type="checkbox" id={p.name+'.deploy'}></input>
</div>)}

</div>

</div>

<script src={getUri("scripts.js")}></script>

</body>
</html>
;

	panel.webview.postMessage({command:'set_checklist', item:'configuration', values:configurationList.map(i => ({name: i}))});
	panel.webview.postMessage({command:'set_checklist', item:'platform', values:platformList.map(i => ({name: i}))});

	update();
}

export function exists() {
	return !!the_panel;
}

export function Set(title: string, config: Configuration, project: MsBuildProject|Solution, file?: string) {
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
	}

	return project instanceof Solution
		? SolutionSettings(panel, title, config, project)
		: ProjectSettings(panel, title, config, project, file);
}


