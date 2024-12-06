import * as path from 'path';
import {XMLCache} from './extension';

export type PackageVersion	= { version: string, downloads: number, '@id': string };
export type Package			= { id: string, version: string, versions: PackageVersion[], '@id': string};
export type Feed 			= { name: string, url: string, userName?: string, password?: string; searchApiUrl: string };

export type Package2		= {
	"@id": string,
	"@type": string,
	registration: string,
	id: string,
	version: string,
	description: string,
	summary: string,
	title: string,
	iconUrl: string,
	licenseUrl: string,
	projectUrl: string,
	tags: string[],
	authors: string[],
	owners: string[],
	totalDownloads: number,
	verified: boolean,
	packageTypes: {name: string}[],
	versions: PackageVersion[],
	//vulnerabilities: [],?
}

const defaultFeed: Feed = {name: "Nuget.org", url: "https://api.nuget.org/v3/index.json", searchApiUrl: ""};

//GET {@id}?q={QUERY}&skip={SKIP}&take={TAKE}&prerelease={PRERELEASE}&semVerLevel={SEMVERLEVEL}&packageType={PACKAGETYPE}
/*
Name		In	Type	Required	Notes
q			URL	string	no			The search terms to used to filter packages
skip		URL	integer	no			The number of results to skip, for pagination
take		URL	integer	no			The number of results to return, for pagination
prerelease	URL	boolean	no			true or false determining whether to include pre-release packages
semVerLevel	URL	string	no			A SemVer 1.0.0 version string
packageType	URL	string	no			The package type to use to filter packages (added in SearchQueryService/3.5.0)
*/

async function callApi(url: string, options: RequestInit, params: Record<string, any>): Promise<any> {
	const url2		= url + '?' + Object.keys(params).map(k => `${k}=${params[k]}`).join('&');
	const response	= await fetch(url2, options);
	const json 		= await response.json();
	return json;
}

export async function searchPackage(feed: Feed, packageName: string): Promise<Package[]> {
	const options: RequestInit = { method: "GET" };
	if (feed.userName || feed.password) {
		const token		= btoa(`${feed.userName || ""}:${feed.password || ""}`);
		options.headers	= { Authorization: `Basic ${token}` };
	}

	if (!feed.searchApiUrl) {
		const response	= await fetch(feed.url, options);
		const json		= await response.json() as any;
		const service 	= Object.fromEntries((json.resources ?? []).map((r: Record<string,string>) => [r['@type'], r['@id']]));
		const key		= Object.keys(service).find((s: string) => s.startsWith("SearchQueryService"));
		if (!key)
			throw new Error(`Nuget search API URL is not found for feed ${feed.name}`);

		feed.searchApiUrl = service[key];
	}

	const json = await callApi(feed.searchApiUrl, options, {q: packageName, skip: 0, take: 50});
	//const searchUrl = `${feed.searchApiUrl}?q=${packageName}&skip=0&take=50`;
	//const response	= await fetch(searchUrl, options);
	//const json 		= await response.json() as any;
	return json.data ?? [];
}

export async function getFeeds(projectPath: string): Promise<Feed[]> {
	const result: Feed[] = [];
	do {
        projectPath = path.dirname(projectPath);
		const configuration = (await XMLCache.get(path.join(projectPath, 'nuget.config')))?.elements.configuration;
		if (configuration) {
			const feeds = configuration.elements.packageSources?.elements.add;
			if (feeds) {
				const packageSourceCredentials  = configuration.elements.packageSourceCredentials;
				for (const f of feeds) {
					const name  = f.attributes.key;
					const url   = f.attributes.value;
					if (name && url) {
						let userName: string | undefined;
						let password: string | undefined;
						for (const i of packageSourceCredentials?.elements[name]?.elements.add || []) {
							if (i.attributes.key === "Username") {
								userName = i.attributes.value;
							} else if (i.attributes.key === "ClearTextPassword") {
								password = i.attributes.value;
							}
						}

						if (result.findIndex(f => f.name === name) < 0)
							result.push({ name, url, searchApiUrl: '', userName, password });
					}
				}
			}
		}
	} while (projectPath !== path.dirname(projectPath));

	if (result.length === 0)
		result.push(defaultFeed);

	return result;
}

