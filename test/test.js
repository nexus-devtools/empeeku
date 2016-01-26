const assert = require('assert');
const fs = require('fs');
const path = require('path');

const MPQArchive = require('../mpyq').MPQArchive;

function test() {
	function testHeader() {
		assert.equal(archive.header.magic, new Buffer('MPQ\x1a'));
		assert.equal(archive.header.headerSize, 44);
		assert.equal(archive.header.archiveSize, 205044);
		assert.equal(archive.header.formatVersion, 1);
		assert.equal(archive.header.hashTableOffset, 204628);
		assert.equal(archive.header.blockTableOffset, 204884);
		assert.equal(archive.header.hashTableEntries, 16);
		assert.equal(archive.header.blockTableEntries, 10);
		assert.equal(archive.header.extendedBlockTableOffset, 0);
		assert.equal(archive.header.hashTableOffsetHigh, 0);
		assert.equal(archive.header.blockTableOffsetHigh, 0);
		assert.equal(archive.header.offset, 1024);
	}
	
	function testFiles() {
    const expected = [
			'replay.attributes.events',
			'replay.details',
			'replay.game.events',
			'replay.initData',
			'replay.load.info',
			'replay.message.events',
			'replay.smartcam.events',
			'replay.sync.events'
		];
		expected.forEach((file, i) => assert.equal(archive.files[i], file));
	}
  
  function testHash() {
    assert.equal(archive._hash('(hash table)', 'TABLE'), 3283040112);
  }
	
  var archive = new MPQArchive(path.dirname(process.argv[1]) + path.sep + 'test.SC2Replay');
	testHeader();
	testFiles();
  testHash();
  
  console.log('TEST SUCCESS');
}

test();