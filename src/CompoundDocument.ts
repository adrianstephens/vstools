import * as binary from "./binary";

const SecID = {
	FREE:		-1,	// Free sector, may exist in the file, but is not part of any stream
	ENDOFCHAIN:	-2,	// Trailing SecID in a SecID chain
	SAT:		-3,	// Sector is used by the sector allocation table
	MSAT:		-4,	// Sector is used by the master sector allocation table
} as const;

export class CompDocHeader {
	public fields : {[id:string] : any} = {};     

	constructor(r : binary.reader) {
		this.fields = r.read_fields(
			['magic',			new binary.BigIntType(8, true)],
			['id',				new binary.Uint8ArrayType(16)],
			['revision',		binary.UINT16_LE],
			['version',			binary.UINT16_LE],
			['byteorder',		binary.UINT16_LE],
			['sector_size',		binary.UINT16_LE],
			['short_size',		binary.UINT16_LE],
			['unused1',			new binary.SkipType(10)],
			['num_sectors',		binary.UINT32_LE],
			['first_sector',	binary.UINT32_LE],
			['unused2',			new binary.SkipType(4)],
			['min_size',		binary.UINT32_LE],
			['first_short',		binary.UINT32_LE],
			['num_short',		binary.UINT32_LE],
			['first_master',	binary.UINT32_LE],
			['num_master',		binary.UINT32_LE],
			['alloc',			new binary.Uint8ArrayType(436)]
		);
	}
	sector_offset(id : number)		{ return (id + 1) << this.fields.sector_size; }
	short_offset(id : number)		{ return id << this.fields.short_size; }

	public valid() { return this.fields.magic == 0xD0CF11E0A1B11AE1n; }
}

const TYPE = {
	Empty:		0,
	UserStorage:	1,
	UserStream:	2,
	LockBytes:	3,
	Property:	4,
	RootStorage:	5,
} as const;
const COLOUR = {
	RED: 0, BLACK: 1
} as const;

class CompDocDirEntry {
	public fields : {[id:string] : any} = {};     

	constructor(r : binary.reader) {
		this.fields = r.read_fields(
			['name',		new binary.StringType(64, 'utf-16')],
			['name_size',	binary.UINT16_LE],
			['type',		binary.UINT8],
			['colour',		binary.UINT8],
			['left',		binary.INT32_LE],
			['right',		binary.INT32_LE],
			['root',		binary.INT32_LE],
			['guid',		new binary.Uint8ArrayType(16)],
			['flags',		binary.UINT32_LE],
			['creation',	binary.UINT64_LE],
			['modification',binary.UINT64_LE],
			['sec_id',		binary.INT32_LE],
			['size',		binary.UINT32_LE],
			['unused',		binary.UINT32_LE]
		);
		this.fields.name = this.fields.name.substr(0, this.fields.name_size / 2 - 1);
	}
}

export class CompDocMaster {
	root : CompDocDirEntry;
	msat : Int32Array;
	nsat : Int32Array;
	ssat : Int32Array;
	shortcont : Uint8Array;

	constructor(r : binary.reader, public header : CompDocHeader) {
		const sector_size = header.fields.sector_size;

		let		num		= header.fields.num_master;
		let		m_size	= 109 + (num << (sector_size - 2));
		this.msat		= new Int32Array(m_size);
		binary.to_raw(this.msat).set(header.fields.alloc, 0);

		let sect	= header.fields.first_master;
		let p		= 109 * 4;
		while (num--) {
			const data	= this.read_sector(r, sect);
			const end	= data.length - 4;
			sect 		= new DataView(data.buffer).getUint32(end);
			binary.to_raw(this.msat).set(data.slice(0, end), p);
			p += end;
		}

		while (this.msat[m_size - 1] == SecID.FREE)
			--m_size;

		const	n_size	= m_size << (sector_size - 2);
		this.nsat		= new Int32Array(n_size);
		for (let i = 0; i < m_size; i++) {
			const data = this.read_sector(r, this.msat[i]);
			binary.to_raw(this.nsat).set(data, i << sector_size);
		}

		const	s_size		= header.fields.num_short << sector_size;
		this.ssat		= new Int32Array(s_size / 4);
		this.read_chain(r, header.fields.first_short, binary.to_raw(this.ssat));

		r.seek(header.sector_offset(header.fields.first_sector));
		this.root = new CompDocDirEntry(r);

		this.shortcont = new Uint8Array(this.root.fields.size);
		this.read_chain(r, this.root.fields.sec_id, this.shortcont);
	}

	sector_size()	{ return 1 << this.header.fields.sector_size; }
	short_size()	{ return 1 << this.header.fields.short_size; }
	next(id : number)	{ return this.nsat[id]; }

	read_sector(r : binary.reader, id : number, len : number = this.sector_size()) : Uint8Array {
		return r.seek(this.header.sector_offset(id)).read_buffer(len);
	}

	chain_length(r : binary.reader, id : number) : number {
		const	ss		= this.sector_size();
		let		size	= 0;
		while (id != SecID.ENDOFCHAIN) {
			size	+= ss;
			id		= this.nsat[id];
		}
		return size;
	}

	read_chain(r : binary.reader, id : number, buffer : Uint8Array) {
		const	ss	= this.sector_size();
		let		p	= 0;
		while (p < buffer.length && id != SecID.ENDOFCHAIN) {
			const data = this.read_sector(r, id, Math.min(ss, buffer.length - p));
			buffer.set(data, p);
			p		+= data.length;
			id		= this.nsat[id];
		}
	}

	read_chain2(r : binary.reader, id : number, buffer : Uint8Array) {
		if (buffer.length >= this.header.fields.min_size)
			return this.read_chain(r, id, buffer);

		const	ss	= this.short_size();
		let		p	= 0;
		while (id != SecID.ENDOFCHAIN) {
			const r = Math.min(ss, buffer.length - p);
			buffer.set(this.shortcont.slice(ss * id, ss * id + r), p);
			p		+= r;
			id		= this.ssat[id];
		}
	}
}


export class CompDocReader extends CompDocMaster {
	public entries : CompDocDirEntry[] = [];

	constructor(public reader : binary.reader, header : CompDocHeader) {
		super(reader, header);
		const first_sector	= header.fields.first_sector;
		const entry_len		= this.chain_length(reader, first_sector);
		const dir_buff 		= new Uint8Array(entry_len);
		this.read_chain(reader, first_sector, dir_buff);
		const r2 = new binary.reader(dir_buff);

		for (let i = 0; i < entry_len / 128; i++)
			this.entries[i] = new CompDocDirEntry(r2.seek(i * 128));
	}

	get(i : number) { return this.entries[i]; }

	find(name : string, i : number = 0) : CompDocDirEntry|undefined {
		const stack = new Array(32);
		let		sp = 0;

		for (;;) {
			const e	= this.get(i);
			if (e.fields.name == name)
				return e;

			if (e.fields.type == TYPE.RootStorage)
				stack[sp++] = e.fields.root;

			if (e.fields.right != -1)
				stack[sp++] = e.fields.right;

			i = e.fields.left;
			if (i == -1) {
				if (sp === 0)
					return undefined;
				i = stack[--sp];
			}
		}
	}

	read(e : CompDocDirEntry) {
		const data = new Uint8Array(e.fields.size);
		this.read_chain2(this.reader, e.fields.sec_id, data);
		return data;
	}
}
