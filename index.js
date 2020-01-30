const Network = require('./network')
const {Blockchain} = require('./blockchain')

const start = async () => {
  const network = await Network.fromSeed('::ffff:498e:8e8a', 8333)
  const app = {
    receive: (message) => {
      if(message.header.type === 'addr')
        network.connect()
    }
  }
  network.subscribe(app)

  const blockchain = new Blockchain(network)
  await blockchain.buildBlockchain()
}

start()