export class CaseInsensitiveString {
	private value: string;
	constructor(value: string)	{ this.value = value.toLowerCase(); }
	get length()				{ return this.value.length;}
	toString() 					{ return this.value; }
  
	includes(searchString: string, position?: number)	{ return this.value.includes(searchString.toLowerCase(), position); }
	startsWith(searchString: string, position?: number)	{ return this.value.startsWith(searchString.toLowerCase(), position); }
	endsWith(searchString: string, position?: number) 	{ return this.value.endsWith(searchString.toLowerCase(), position); }
	indexOf(searchString: string, position?: number) 	{ return this.value.indexOf(searchString.toLowerCase(), position); }
	lastIndexOf(searchString: string, position?: number){ return this.value.lastIndexOf(searchString.toLowerCase(), position); }

	compare(other: string) 	{ const bi = other.toLowerCase(); return this.value < bi ? -1 : this.value > bi ? 1 : 0; }
}

// keeps original string
export class CaseInsensitiveString2 extends CaseInsensitiveString {
	constructor(private orig: string) { super(orig); }
	toString() 		{ return this.orig; }
}

export function String(value: string) {
	return new CaseInsensitiveString(value);
}
export function String2(value: string) {
	return new CaseInsensitiveString2(value);
}

export function compare(a: string, b: string) {
	const ai = a.toUpperCase(), bi = b.toUpperCase();
	return ai < bi ? -1 : ai > bi ? 1 : 0;
}

export function Record<T>(obj: Record<string, T>) {
	return new Proxy(obj, {
		get: (target, name:string) => target[name.toUpperCase()],
		set: (target, name:string, value:T) => (target[name.toUpperCase()] = value, true),
		has: (target, name:string) => name.toUpperCase() in target,
	});
}

// keeps original record
export function Record2<T>(obj: Record<string, T>) {
	return new Proxy(Object.entries(obj).reduce((acc, [key, value]) => ((acc[key.toUpperCase()] = value), acc), {} as Record<string, T>), {
		get: 		(target, name:string)				=> target[name.toUpperCase()],
		set: 		(target, name:string, value:T)		=> (target[name.toUpperCase()] = value, true),
		has: 		(target, name:string)				=> name.toUpperCase() in target,
		ownKeys:	(target) 							=> Object.keys(obj),
		getOwnPropertyDescriptor: (target, name:string) => Object.getOwnPropertyDescriptor(obj, name)
	});
}
