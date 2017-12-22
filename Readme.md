# mpyq.js

This is a fork of [mpyq.js](https://github.com/Farof/mpyqjs), which is a port of the [mpyq Python library](https://github.com/eagleflo/mpyq) for reading MPQ archives used in many of Blizzard's games. This fork fixes a major bug related to opening multipart archives. 

It is a straightforward port with the same functionnalities and limitations. See the [original Readme](https://github.com/eagleflo/mpyq) for details.

## Installation

    npm install -S empeeku

## Usage

### As a library

    const mpq = require('empeeku');
    const MPQArchive = mpq.MPQArchive;

### From the command line

    usage: mpq.js [-h] [-I] [-H] [-b] [-s] [-t] [-x] file

    mpq.js reads and extracts MPQ archives

    Options:
      -h, --help           show this help message and exit                 [boolean]
      -I, --headers        print header information from the archive       [boolean]
      -H, --hash-table     print hash table                                [boolean]
      -b, --block-table    print block table                               [boolean]
      -s, --skip-listfile  skip reading(listfile)                          [boolean]
      -t, --list-file      list files inside the archive                   [boolean]
      -x, --extract        extract files from the archive                  [boolean]


## Port status

This is a direct port with nothing fancy and little Javascript adjustments or optimizations.

While this port has been successfully used to perform the operations provided and analyze replay files of Heroes of the Storm, not all codepaths have been tested and bugs may arise.

## License

empeeku ISC License (ISC) - Copyright (c) 2017, Andy Baird

mpyq.js ISC License (ISC) - Copyright (c) 2016, Mathieu Merdy

---

Original library license: Copyright (c) 2010-2014 Aku Kotkavuo. All rights reserved.
