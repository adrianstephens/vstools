import * as binary from "./binary";
import { promises as fs } from 'fs';

const SecID = {
	FREE:		-1,	// Free sector, may exist in the file, but is not part of any stream
	ENDOFCHAIN:	-2,	// Trailing SecID in a SecID chain
	SAT:		-3,	// Sector is used by the sector allocation table
	MSAT:		-4,	// Sector is used by the master sector allocation table
} as const;

class FAT {
	fat:	Int32Array;
	freed:	number[] = [];
	dirty_fat	= new Set<number>();
	dirty_sec	= new Set<number>();

	constructor(size: number, public shift:number, public sectors: Uint8Array) {
		this.fat = new Int32Array(size);
	}

	private free(id: number) {
		this.freed.push(id);
		this.fat[id] = SecID.FREE;
		this.dirty_fat.add(id >> (this.shift - 2));
	}
	private alloc(prev: number) {
		if (!this.freed.length) {
			this.fat.forEach((v, i) => {
				if (v === SecID.FREE)
					this.freed.push(i);
			});
		}
		const	id = this.freed.length ? this.freed.pop()! : this.fat.length;
		this.fat[prev] = id;
		this.dirty_fat.add(id >> (this.shift - 2));
		return id;
	}
	get_chain(id: number): number[] {
		const	chain	= [];
		while (id != SecID.ENDOFCHAIN) {
			chain.push(id);
			id	= this.fat[id];
		}
		return chain;
	}
	resize_chain(chain: number[], data_size: number) {
		const size = (data_size + (1 << this.shift) - 1) >> this.shift;

		while (chain.length > size)
			this.free(chain.pop()!);

		if (size) {
			let last = chain[size - 1];
			while (chain.length < size)
				chain.push(last = this.alloc(last));

			if (this.fat[last] !== SecID.ENDOFCHAIN) {
				this.fat[last] = SecID.ENDOFCHAIN;
				this.dirty_fat.add(last >> (this.shift - 2));
			}

		} else {
			chain.push(SecID.ENDOFCHAIN);
		}
	}

	clear_dirty() {
		this.dirty_fat.clear();
		this.dirty_sec.clear();
	}

	read_chain(chain: number[], dest: Uint8Array) {
		chain.forEach((id, index) => {
			const id2		= id << this.shift;
			const index2	= index << this.shift;
			dest.set(this.sectors.subarray(id2, id2 + Math.min(dest.length - index2)), index2);
		});
	}
	read_chain_alloc(chain: number[]) {
		const dest	= new Uint8Array(chain.length << this.shift);
		this.read_chain(chain, dest);
		return dest;
	}
	read(id: number, dest: Uint8Array) {
		this.read_chain(this.get_chain(id), dest);
	}

	write_chain(chain: number[], source: Uint8Array) {
		chain.forEach((id, index) => {
			this.sectors.set(source.subarray(index << this.shift, (index + 1) << this.shift), id  << this.shift);
			this.dirty_sec.add(id);
		});
	}
	dirty_chain_part(chain: number[], offset: number) {
		const sector = chain[offset >> this.shift];
		this.dirty_sec.add(sector);
		return this.sectors.subarray((sector << this.shift) + (offset & ((1 << this.shift) - 1)));
	}

}

export class Header {
	static fields = {
		magic:			new binary.BigIntType(8, true),
		id:				new binary.Uint8ArrayType(16),
		revision:		binary.UINT16_LE,
		version:		binary.UINT16_LE,
		byteorder:		binary.UINT16_LE,
		sector_shift:	binary.UINT16_LE,
		mini_shift:		binary.UINT16_LE,
		unused1:		new binary.SkipType(6),
		num_directory:	binary.UINT32_LE,
		num_fat:		binary.UINT32_LE,
		first_directory:binary.UINT32_LE,
		transaction:	new binary.SkipType(4),	//must be 0
		mini_cutoff:	binary.UINT32_LE,
		first_mini:		binary.UINT32_LE,
		num_mini:		binary.UINT32_LE,
		first_difat:	binary.UINT32_LE,
		num_difat:		binary.UINT32_LE,
		difat:			new binary.Uint8ArrayType(436),
	};

	public fields: {[id:string]: any} = {};     

	constructor(r: binary.stream) {
		this.fields = r.read_fields(Header.fields);
	}

	write(w: binary.stream) 	{ w.write_fields(Header.fields, this.fields); }
	sector_size()				{ return 1 << this.fields.sector_shift; }
	use_mini(size: number)		{ return size < this.fields.mini_cutoff; }
	valid()						{ return this.fields.magic == 0xD0CF11E0A1B11AE1n; }
}

const TYPE = {
	Empty:			0,
	UserStorage:	1,
	UserStream:		2,
	LockBytes:		3,
	Property:		4,
	RootStorage:	5,
} as const;

const COLOUR = {
	RED: 0, BLACK: 1
} as const;

class DirEntry {
	static fields = {
		name:			new binary.FixedStringType(64, 'utf16le'),
		name_size:		binary.UINT16_LE,
		type:			binary.UINT8,
		colour:			binary.UINT8,
		left:			binary.INT32_LE,
		right:			binary.INT32_LE,
		root:			binary.INT32_LE,
		guid:			new binary.Uint8ArrayType(16),
		flags:			binary.UINT32_LE,
		creation:		binary.UINT64_LE,
		modification:	binary.UINT64_LE,
		sec_id:			binary.INT32_LE,
		size:			binary.UINT32_LE,
		unused:			binary.UINT32_LE
	};
	public fields: {[id:string]: any} = {};

	constructor(public index: number, r: binary.stream) {
		this.fields = r.read_fields(DirEntry.fields);
		this.fields.name = this.fields.name.substr(0, this.fields.name_size / 2 - 1);
	}
	write(w: binary.stream) {
		w.write_fields(DirEntry.fields, this.fields);
	}

	load(fat: FAT) {
		const data	= new Uint8Array(this.fields.size);
		fat.read(this.fields.sec_id, data);
		return data;
	}
}

export class Master {
	difat: 			Int32Array;
	fat: 			FAT;
	mini_fat: 		FAT;
	mini_chain:		number[];

	constructor(sectors: Uint8Array, public header: Header) {
		const 	shift	= header.fields.sector_shift;
		let		num		= header.fields.num_difat;
		let		m_size	= 109 + (num << (shift - 2));
		this.difat		= new Int32Array(m_size);
		binary.to_raw(this.difat).set(header.fields.difat, 0);

		let 	sect	= header.fields.first_difat;
		let 	p		= 109 * 4;
		while (num--) {
			const data	= sectors.subarray(sect << shift, (sect + 1) << shift);
			const end	= data.length - 4;
			sect 		= new DataView(data.buffer).getUint32(end);
			binary.to_raw(this.difat).set(data.subarray(0, end), p);
			p += end;
		}

		while (this.difat[m_size - 1] == SecID.FREE)
			--m_size;

		this.fat	= new FAT(m_size << (shift - 2), shift, sectors);

		Array.from(this.difat.subarray(0, m_size)).forEach((id, index) => {
			const data	= sectors.subarray(id << shift, (id + 1) << shift);
			binary.to_raw(this.fat.fat).set(data, index << shift);
		});

		const	root	= new DirEntry(0, new binary.stream(sectors.subarray(header.fields.first_directory << shift)));
		this.mini_chain = this.fat.get_chain(root.fields.sec_id);
		this.mini_fat	= new FAT(header.fields.num_mini << (shift - 2), header.fields.mini_shift, root.load(this.fat));
		this.fat.read(header.fields.first_mini, binary.to_raw(this.mini_fat.fat));
	}

	get_fat(mini: boolean) {
		return mini ? this.mini_fat : this.fat;
	}

	async flush(filename: string) {
		const dirty	= new Set(this.fat.dirty_sec);

		function mark_dirty_shift(entries: Iterable<number>, translate: number[], shift: number) {
			for (const i of entries)
				dirty.add(translate[i >> shift]);
		}

		const mini_extra = this.fat.shift - this.header.fields.mini_shift;
		mark_dirty_shift(this.fat.dirty_fat.keys(), Array.from(this.difat), 0);
		mark_dirty_shift(this.mini_fat.dirty_sec, this.mini_chain, mini_extra);
		mark_dirty_shift(this.mini_fat.dirty_fat.keys(), this.fat.get_chain(this.header.fields.first_mini), mini_extra);

		if (!dirty.size)
			return;

		let fileHandle: fs.FileHandle|undefined;

		try {
			fileHandle = await fs.open(filename, 'r+');

			const	ss	= 1 << this.fat.shift;
			for (const i of dirty.keys()) {
				const position = i * ss;
				await fileHandle.write(this.fat.sectors, position, ss, position + ss);
			}
			this.fat.clear_dirty();
			this.mini_fat.clear_dirty();

		} catch (error) {
			console.error('An error occurred:', error);
		} finally {
			if (fileHandle)
				await fileHandle.close();
		}
	}
}

export class Reader extends Master {
	public entries: 		DirEntry[] = [];
	private entry_chain:	number[];

	constructor(sectors: Uint8Array, header: Header) {
		super(sectors, header);

		this.entry_chain	= this.fat.get_chain(header.fields.first_directory);
		const 	dir_buff 	= this.fat.read_chain_alloc(this.entry_chain);
		const 	r2			= new binary.stream(dir_buff);
		for (let i = 0; i < dir_buff.length / 128; i++)
			this.entries[i] = new DirEntry(i, r2.seek(i * 128));
	}

	find(name: string, i: number = 0): DirEntry|undefined {
		const stack = [];
		let		sp = 0;

		for (;;) {
			const e	= this.entries[i];
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

	read(e: DirEntry) {
		const mini	= this.header.use_mini(e.fields.size);
		const fat	= this.get_fat(mini);
		return e.load(fat);
	}

	write(e: DirEntry, data: Uint8Array) {
		const mini1	= this.header.use_mini(e.fields.size);
		const fat1	= this.get_fat(mini1);
		const chain = fat1.get_chain(e.fields.sec_id);

		const mini2	= this.header.use_mini(data.length);
		const fat2	= this.get_fat(mini2);

		if (data.length != e.fields.size) {
			if (mini1 != mini2)
				fat1.resize_chain(chain, 0);
			fat2.resize_chain(chain, data.length);

			e.fields.size	= data.length;
			e.fields.sec_id = chain[0];

			const dest = this.fat.dirty_chain_part(this.entry_chain, e.index * 128);
			e.write(new binary.stream(dest));
		}

		fat2.write_chain(chain, data);
	}
}
