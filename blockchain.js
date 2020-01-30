const store = require('./store')
const {Op} = require('sequelize')
const logger = require('./logger')
const fs = require('fs')

const genesisblock = {
  height: 0,
  hash: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
  raw: '0100000000000000000000000000000000000000000000000000000000000000000000003ba3eded7a7b12b27ac72c3e67768e617ec81bc3888a51323a9eb8aa4b1e5e4a29ab5e49eeee001d1dac2b7c'
}

class Blockchain {
  constructor(network){
    this.height = 0
    this.state = 'unsynced'
    this.network = network
    this.network.subscribeMessage('inv', {
      receive: (message) => {
        if(this.state === 'synced' && message.payload.vectors[0].type === 2 && message.payload.vectors[0].hash !== this.lastBlock.hash) { // new block
          this.state === 'unsynced'
          this.sendGetheaders(this.lastBlock.hash)
        }
      }
    })

    this.network.subscribeMessage('networkconnected', {
      connected: () => this.buildUTXO()
    })

    this.network.subscribeMessage('headers', {
      receive: async (message) => {
        let header, decoded
        for(let i = 0; i<message.payload.headers.length; i++){
          header = message.payload.headers[i]
          decoded = store.block.readRawHeader(Buffer.from(header.raw, 'hex'))
          if(decoded.prev_block === this.lastBlock.hash){
            header.height = this.lastBlock.height+1
            await store.block.create(header)
            this.lastBlock = header
          }
        }
        if(decoded && (Date.now()/1000 - decoded.timestamp > 3600)){
          this.sendGetheaders(this.lastBlock.hash)
        } else {
          if(this.state !== 'synced') {
            logger.info('------ NODE SYNCED -----')
          }
          this.state = 'synced'
        }
      }
    })
  }

  async buildBlockchain() {
    this.height = await store.block.count()
    this.lastBlock = await store.block.findOne({
      order:[['height', 'DESC']]
    })
    if(!this.lastBlock) {
      this.lastBlock = genesisblock
      await store.block.create(this.lastBlock)
    }
    this.sendGetheaders(this.lastBlock.hash)
    
  }

  sendGetheaders(hash) {
    this.network.sendGetheaders(hash)
    const that = this
    setTimeout(()=> {
      if(that.lastBlock.hash === hash && that.state === 'unsynced'){
        that.sendGetheaders(hash)
      }
    }, 10000)
  }

  readUTXO(file){
    const rawdata = JSON.parse(fs.readFileSync(file))
    return rawdata
  }

  writeUTXO(utxo, file){
    let data = JSON.stringify(utxo)
    fs.writeFileSync(file, data)
  }

  readUTXODB(){
    const rawdata = this.store.utxo.findAll()
    utxo = {}
    rawdata.forEach(out => {
      if(utxo[tx.hash]){

      }
    })
    return utxo
  }

  writeUTXODB(utxo){
    let data = JSON.stringify(utxo)
    fs.writeFileSync(file, data)
  }

  async buildUTXODB() {
    if(this.state === 'synced' && ! this.utxostarted) {
      this.utxostarted = true
      const utxo = this.readUTXODB()
      let height = this.store.state.get('utxo.height')
      const step = this.store.state.get('utxo.step')

      utxo.lastBlocks = await store.block.findAll({where:{height: {[Op.between]: [height, height + step]}}})
      while (height < this.lastBlock.height) {
        try { 
          const blocks = await this.network.getBlockTransactions(utxo.lastBlocks.map(block => block.hash))
          blocks.forEach(block => {
            const transactions = block.transactions
            // coinbase creaction
            utxo[transactions[0].getHash().toString('hex')] = transactions[0].outs
            // other transactions
            transactions.slice(1).forEach(tx => {
              tx.ins.forEach(input => {
                const inhash = input.hash.toString('hex')
                if(utxo[inhash]) { // spent
                  utxo[inhash][input.index] = null
                  // check if all spent
                  if(!utxo[inhash].find(inp => inp !== null)) {
                    delete utxo[inhash]
                  }
                } else {
                  // logger.warn('bang pabo '+ JSON.stringify(tx))
                }
              })
              const txhash = tx.getHash().toString('hex')
              utxo[txhash] = tx.outs
              if(tx.timelock) {
                utxo[txhash].timelock = tx.timelock
              }
            })
          })
          height += step + 1
          utxo.lastBlocks = await store.block.findAll({where:{height: {[Op.between]: [height, height + step]}}})
          if(height % 1000 === 0) {
            this.writeUTXO(utxo,'./utxo.json')
          }
        } catch(error) {
          logger.debug(error)
        }
      }
      return utxo
    }
    return null
  }

  async buildUTXO() {
    if(this.state === 'synced' && ! this.utxostarted) {

      // create new progress bar
      
      this.utxostarted = true
      const utxo = this.readUTXO('./utxo.json')
      let height = utxo.lastBlocks ? utxo.lastBlocks[utxo.lastBlocks.length-1].height + 1 : 0
      const step = utxo.lastBlocks ? utxo.lastBlocks.length - 1 : 4

      utxo.lastBlocks = await store.block.findAll({where:{height: {[Op.between]: [height, height + step]}}})
      while (height < this.lastBlock.height) {
        try { 
          const blocks = await this.network.getBlockTransactions(utxo.lastBlocks.map(block => block.hash))
          blocks.forEach(block => {
            const transactions = block.transactions
            // coinbase creaction
            utxo[transactions[0].getHash().toString('hex')] = transactions[0].outs
            // other transactions
            transactions.slice(1).forEach(tx => {
              tx.ins.forEach(input => {
                const inhash = input.hash.toString('hex')
                if(utxo[inhash]) { // spent
                  delete utxo[inhash][input.index]
                  if(utxo[inhash].length === 0) {
                    delete utxo[inhash]
                  }
                } else {
                  // logger.warn('bang pabo', + JSON.stringify(tx, null, 2))
                  // logger.warn(JSON.stringify(input, null, 2))
                }
              })
              const txhash = tx.getHash().toString('hex')
              utxo[txhash] = tx.outs
              if(tx.timelock) {
                utxo[txhash].timelock = tx.timelock
              }
            })
          })
          height += step + 1
          utxo.lastBlocks = await store.block.findAll({where:{height: {[Op.between]: [height, height + step]}}})
          if(height % 1000 === 0) {
            this.writeUTXO(utxo,'./utxo.json')
          }
        } catch(error) {
          logger.debug(error)
        }
      }
      return utxo
    }
    return null
  }
}

module.exports = {
  Blockchain
}
