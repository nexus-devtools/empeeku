
/* mpyq.js is a Javascript port of the mpyq Python library for reading MPQ (MoPaQ) archives. */

const path = require('path');
const fs = require('fs');
const bzip = require('seek-bzip');
const zlib = require('zlib');
const Long = require('long');

exports.version = require('./package.json').version;


const MPQ_FILE_IMPLODE 			  = 0x00000100;
const MPQ_FILE_COMPRESS 		  = 0x00000200;
const MPQ_FILE_ENCRYPTED 		  = 0x00010000;
const MPQ_FILE_FIX_KEY			  = 0x00020000;
const MPQ_FILE_SINGLE_UNIT		= 0x01000000;
const MPQ_FILE_DELETE_MARKER	= 0x02000000;
const MPQ_FILE_SECTOR_CRC	 	  = 0x04000000;
const MPQ_FILE_EXISTS		 	    = 0x80000000;

function MPQFileHeader(data) {
	this.magic = data.toString('utf8', 0, 4);
	this.headerSize = data.readUInt32LE(4);
	this.archiveSize = data.readUInt32LE(8);
	this.formatVersion = data.readUInt16LE(12);
	this.sectorSizeShift = data.readUInt16LE(14);
	this.hashTableOffset = data.readUInt32LE(16);
  this.blockTableOffset = data.readUInt32LE(20);
  this.hashTableEntries = data.readUInt32LE(24);
  this.blockTableEntries = data.readUInt32LE(28);
}

function MPQFileHeaderExt(data) {
	this.extendedBlockTableOffset = data.readIntLE(0, 8);
  this.hashTableOffsetHigh = data.readInt8(8);
  this.blockTableOffsetHigh = data.readInt8(10);
}

function MPQUserDataHeader(data) {
	this.magic = data.toString('utf8', 0, 4);
	this.userDataSize = data.readUInt32LE(4);
	this.mpqHeaderOffset = data.readUInt32LE(8);
	this.userDataHeaderSize = data.readUInt32LE(12);
}

function MPQHashTableEntry(data) {
	this.hashA = data.readUInt32BE(0);
	this.hashB = data.readUInt32BE(4);
	this.locale = data.readUInt16BE(8);
	this.platform = data.readUInt16BE(10);
	this.blockTableIndex = data.readUInt32BE(12);
}

function MPQBlockTableEntry(data) {
	this.offset = data.readUInt32BE(0);
	this.archivedSize = data.readUInt32BE(4);
	this.size = data.readUInt32BE(8);
	this.flags = data.readUInt32BE(12);
}


const MPQArchive = function(filename, listfile) {
  /*
    Create a MPQArchive object.
    
    You can skip reading the listfile if you pass listfile=false
    to the constructor. The 'files' attribute will be unavailable
    if you do this.
  */
	if (typeof listfile === 'undefined') listfile = true;
	
	if (filename instanceof Buffer) {
		this.file = filename;
  } else {
    this.filename = filename;
		this.file = fs.readFileSync(filename);
  }
	
	this.header = this.readHeader();
	this.hashTable = this.readTable('hash');
	this.blockTable = this.readTable('block');

	if (listfile) {
		this.files = this.readFile('(listfile)').toString().trim().split('\r\n');
	} else {
		this.files = null;
	}
};

MPQArchive.prototype.readHeader = function() {
  // Read the header of a MPQ archive.
	var magic = this.file.toString('utf8', 0, 4), header;
	
	if (magic === 'MPQ\x1a') {
		header = this.readMPQHeader();
		header.offset = 0;
	} else if (magic === 'MPQ\x1b') {
		var userDataHeader = this.readMPQUserDataHeader();
		header = this.readMPQHeader(userDataHeader.mpqHeaderOffset);
		header.offset = userDataHeader.mpqHeaderOffset;
		header.userDataHeader = userDataHeader;
	} else {
		throw new Error('Invalid file header');
	}
	
	return header;
};

MPQArchive.prototype.readMPQHeader = function(offset) {
	offset = offset || 0;
	
	var data = this.file.slice(offset, offset + 32);
	var header = new MPQFileHeader(data);
	
	if (header.formatVersion === 1) {
		data = this.file.slice(offset + 32, offset + 32 + 12);
		Object.assign(header, new MPQFileHeaderExt(data));
	}
	
	return header;
};

MPQArchive.prototype.readMPQUserDataHeader = function() {	
	var data = this.file.slice(0, 16);
	var header = new MPQUserDataHeader(data);
	header.content = this.file.slice(16, 16 + header.userDataHeaderSize);
	return header;
};

MPQArchive.prototype.readTable = function(tableType) {
  // Read either the hash or block table of a MPQ archive.
	var Type;
	if (tableType === 'hash') {
		Type = MPQHashTableEntry;
	} else if (tableType === 'block') {
		Type = MPQBlockTableEntry;
	} else {
		throw new Error('Invalid table type.');
	}
	
	var tableOffset = this.header[tableType + 'TableOffset'];
	var tableEntries = this.header[tableType + 'TableEntries'];
	
	var key = this._hash('(' + tableType + ' table)', 'TABLE');
	
	var data = this.file.slice(tableOffset + this.header.offset, tableOffset + this.header.offset + tableEntries * 16);
	data = this._decrypt(data, key);
	
	var entries = [];
	
	for (var i = 0; i < tableEntries; i += 1) {
    entries[i] = new Type(data.slice(i * 16, i * 16 + 16));
	}
	
	return entries;
}

MPQArchive.prototype.getHashTableEntry = function(filename) {
  // Get the hash table entry corresponding to a given filename.
  var hashA = this._hash(filename, 'HASH_A');
  var hashB = this._hash(filename, 'HASH_B');
  
  for (var entry of this.hashTable) {
    if (entry.hashA === hashA && entry.hashB === hashB) return entry;
  }
};

MPQArchive.prototype.readFile = function(filename, forceDecompress) {
  // Read a file from the MPQ archive.
  function decompress(data) {
    // Read the compression type and decompress file data.
    var compressionType = data.readUInt8(0);
    
    if (compressionType === 0) return data;
    else if (compressionType === 2) return zlib.unzipSync(data.slice(1));
    else if (compressionType === 16) return bzip.decode(data.slice(1));
    else throw new Error('Unsupported compression type.');
  }
  
  var hashEntry = this.getHashTableEntry(filename);
  if (!hashEntry) return null;
  var blockEntry = this.blockTable[hashEntry.blockTableIndex];
  
  // Read the block.
  if (blockEntry.flags & MPQ_FILE_EXISTS) {
    if (blockEntry.archivedSize === 0) return null;

    var offset = blockEntry.offset + this.header.offset;
    var fileData = this.file.slice(offset, offset + blockEntry.archivedSize);

    if (blockEntry.flags & MPQ_FILE_ENCRYPTED) {
      throw new Error('Encryption is not yupported yet');
    }

    if (!(blockEntry.flags & MPQ_FILE_SINGLE_UNIT)) {
      // File consists of many sectors. They all need to be
      // decompressed separately and united.

      var sectorSize = 512 << this.header.sectorSizeShift;
      var sectors = Math.trunc(blockEntry.size / sectorSize) + 1;
      var crc;

      if (blockEntry.flags & MPQ_FILE_SECTOR_CRC) {
        crc = true;
        sectors += 1;
      } else {
        crc = false;
      }

      var positions = [], i;
      for (i = 0; i < (sectors + 1); i += 1) {
        positions[i] = fileData.readUInt32LE(4*i);
      }
      
      var ln = positions.length - (crc ? 2 : 1);
      var result = new Buffer(0);
      var sectorBytesLeft = blockEntry.size;
      for (i = 0; i < ln; i+= 1) {
        var sector = fileData.slice(positions[i], positions[i + 1]);
        if ((blockEntry.flags & MPQ_FILE_COMPRESS) && (forceDecompress || (sectorBytesLeft > sector.length))) {
          sector = decompress(sector);
        }
        sectorBytesLeft -= sector.length;
        result = new Buffer.concat([result, sector]);
      }
      fileData = result;
    } else {
      // Single unit files only need to be decompressed, but
      // compression only happens when at least one byte is gained.
      if ((blockEntry.flags & MPQ_FILE_COMPRESS) && (forceDecompress || (blockEntry.size > blockEntry.archivedSize))) {
        fileData = decompress(fileData);
      }
    }
    
    return fileData;
  }
};

MPQArchive.prototype.extract = function() {
  // Extract all the files inside the MPQ archive in memory.
  if (this.files) {
    return this.files.map(filename => {
      return [filename, this.readFile(filename)];
    });
  } else {
    throw new Error('Can\'t extract whole archive without listfile.');
  }
};

MPQArchive.prototype.extractToDisk = function() {
  // Extract all files and write them to disk.
  var extension = path.extname(this.filename);
  var archiveName = path.basename(this.filename, extension);
  var dirName = path.join(process.cwd(), archiveName);
  
  try {
    fs.statSync(dirName)
  } catch (err) {
    fs.mkdirSync(dirName);
  } 
  
  process.chdir(archiveName);
  
  this.extract().forEach(pair => {
    fs.writeFileSync(pair[0], pair[1] || '');
  });
};

MPQArchive.prototype.extractFiles = function(filenames) {
  // Extract given files from the archive to disk.
  for (filename of filenames) {
    fs.mriteFileSync(filename, this.readFile(filename));
  }
};

MPQArchive.prototype.printHeaders = function() {
	console.log('MPQ archive header');
	console.log('------------------');
	for (var key in this.header) {
		if (key === 'userDataHeader') continue;
		console.log(key + ' - ' + this.header[key]);
	}
	
	if (this.header.userDataHeader) {
		console.log();
		console.log('MPQ user data header');
		console.log('--------------------');
		console.log();
		for (var key in this.header.userDataHeader) {
			console.log(key + ' - ' + this.header.userDataHeader[key]);
		}
	}
	console.log();
};

function leadingChar(str, ch, ln, after) {
  str = '' + str;
  while (str.length < ln) {
    str = after ? str + ch : ch + str;
  }
  return str;
}

function formatWord(data, ln) {
  return leadingChar(data.toString(16).toUpperCase(), '0', ln);
}

MPQArchive.prototype.printHashTable = function() {
	console.log('MPQ archive hash table');
	console.log('----------------------');
	console.log('Hash A\t\tHash B\t\tLocl\tPlat\tBlockIdx');
  var format = [8, 8, 4, 4, 8];
	this.hashTable.forEach(entry => {
		console.log(Object.keys(entry).map((key, i) => {
      return formatWord(entry[key], format[i]);
    }).join('\t'));
	});
	console.log();
};

MPQArchive.prototype.printBlockTable = function() {
  console.log('MPQ archive block table');
  console.log('-----------------------');
  console.log('Offset\t\tArchSize\tRealSize\tFlags');
  this.blockTable.forEach(entry => {
    console.log([
      formatWord(entry.offset, 8),
      leadingChar(entry.archivedSize, ' ', 8),
      leadingChar(entry.size, ' ', 8),
      formatWord(entry.flags, 8)
    ].join('\t'));
  });
  console.log();
};

MPQArchive.prototype.printFiles = function() {
  var width = this.files.reduce((top, filename) => Math.max(top, filename.length), 0), hashEntry, blockEntry;
  
  console.log('Files');
  console.log('-----');
  for (var filename of this.files) {
    hashEntry = this.getHashTableEntry(filename);
    blockEntry = this.blockTable[hashEntry.blockTableIndex];
    
    console.log(leadingChar(filename, ' ', width, true) + ' ' + leadingChar(blockEntry.size, ' ', 8) + ' bytes');
  }
};


const hashTypes = {
	'TABLE_OFFSET': 0,
	'HASH_A': 		1,
	'HASH_B': 		2,
	'TABLE': 		3
};
MPQArchive.prototype._hash = function(string, hashType) {
  // Hash a string using MPQ's hash function.
	var seed1, seed2, ch, value;
	
	seed1 = new Long.fromValue(0x7FED7FED, true);
  seed2 = new Long.fromValue(0xEEEEEEEE, true);
  
  for (ch of string.toUpperCase()) {
    if (isNaN(parseInt(ch, 10))) ch = ch.codePointAt(0);
    
    value = new Long.fromValue(this.encryptionTable[(hashTypes[hashType] << 8) + ch], true);
    seed1 = value.xor(seed1.add(seed2)).and(0xFFFFFFFF);
    seed2 = seed1.add(seed2).add(ch).add(seed2.shiftLeft(5)).add(3).and(0xFFFFFFFF);
  }
	
	return seed1.toNumber();
};

MPQArchive.prototype._decrypt = function(data, key) {
  // Decrypt hash or block table or a sector.
	var seed1, seed2, result = new Buffer(data.length);
	var	i, ln = data.length / 4, value;
	
	seed1 = new Long.fromValue(key, true);
  seed2 = new Long.fromValue(0xEEEEEEEE, true);
  
  for (i = 0; i < ln; i += 1) {
    seed2 = seed2.add(this.encryptionTable[0x400 + (seed1 & 0xFF)]);
    seed2 = seed2.and(0xFFFFFFFF);
    value = new Long.fromValue(data.readUInt32LE(i * 4), true);
    value = value.xor(seed1.add(seed2)).and(0xFFFFFFFF);
    
    seed1 = seed1.xor(-1).shiftLeft(0x15).add(0x11111111).or(seed1.shiftRight(0x0B));
    seed1 = seed1.and(0xFFFFFFFF);
    seed2 = value.add(seed2).add(seed2.shiftLeft(5)).add(3).and(0xFFFFFFFF);
    
    result.writeUInt32BE(value.toNumber(), i * 4);
  }
	
	return result;
};

MPQArchive.prototype.encryptionTable = (function() {
  // Prepare encryption table for MPQ hash function.
	var seed, index, t1, t2, i, j;
	var table = {};
	
	seed = new Long.fromValue(0x00100001, true);
		
  for (i = 0; i < 256; i += 1) {
    index = i;
    for (j = 0; j < 5; j += 1) {
      seed = seed.mul(125).add(3).mod(0x2AAAAB);
      t1 = seed.and(0xFFFF).shiftLeft(0x10);
      
      seed = seed.mul(125).add(3).mod(0x2AAAAB);
      t2 = seed.and(0xFFFF);
      
      table[index] = t1.or(t2).toNumber();
      index += 0x100;
    }
  }
	
	return table;
})();

exports.MPQArchive = MPQArchive;

if (require.main === module) {
	(function () {
		const yargs = require('yargs')
						.usage('usage: mpq.js [-h] [-I] [-H] [-b] [-s] [-t] [-x] file\n\nmpq.js reads and extracts MPQ archives')
						.demand(1)
						.alias('h', 'help').boolean('h').describe('h', 'show this help message and exit')
						.alias('I', 'headers').boolean('I').describe('I', 'print header information from the archive')
						.alias('H', 'hash-table').boolean('H').describe('H', 'print hash table')
						.alias('b', 'block-table').boolean('b').describe('b', 'print block table')
						.alias('s', 'skip-listfile').boolean('s').describe('s', 'skip reading(listfile)')
						.alias('t', 'list-file').boolean('t').describe('t', 'list files inside the archive')
						.alias('x', 'extract').boolean('x').describe('x', 'extract files from the archive');

		const args = yargs.argv, filename = process.cwd() + path.sep + args._[0];
		
		var archive = null;
		
		if (!args.skipListfile) archive = new MPQArchive(filename);
		else archive = new MPQArchive(filename, false);
		
    if (args.help) {
      yargs.showHelp();
      process.exit();
    }
		if (args.headers) archive.printHeaders();
		if (args.hashTable) archive.printHashTable();
		if (args.blockTable) archive.printBlockTable();
		if (args.listFile) archive.printFiles();
		if (args.extract) archive.extractToDisk();
    
	})();
}