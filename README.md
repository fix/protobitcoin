This is testing package to play with bitcoin protocol and ultimatly make a simple lite node (ie verifying only the signatures to validate the txs in a block, and no txpool)

right now it:
- discover nodes
- answer partially to nodes requests (ping for instance)
- rebuild blockchain with block headers
- rebuild unspent utxo (still highly experimental)


# TODO
- remove sqlite/sequelize in favor of leveldb
- remove dependency to bitcoinjs lib in favor of copy paste and cleaning of dependencies
- remove ip package

