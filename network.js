const Client = require('./client')
const {Model} = require('sequelize')
const logger = require('./logger')

class Peer extends Model {

}

class Network {
  constructor() {
    this.peers = {}
    this.connected = {}
    this.subscribers = []
    this.promises = {}
  }

  addPeer(peer) {
    if(!this.peers[peer.ip]) {
      this.peers[peer.ip] = peer
    }
  }

  banPeer(ip) {
    delete this.peers[ip]
  }

  subscribe(subscriber) {
    this.subscribers['all'] = subscriber
  }

  subscribeMessage(message, subscriber){
    this.subscribers[message] = subscriber
  }

  async connect() {
    let peers = Object.keys(this.peers)
    const max_peers = 40
    if(peers.length < 500) {
      const seedclients = Object.values(this.connected)
      const rand = Math.floor(Math.random() * seedclients.length)
      seedclients[rand].sendGetaddr()
    } else if(Object.keys(this.connected).length === 1) {
      while(Object.keys(this.connected).length < max_peers){
        peers = Object.keys(this.peers)
        const rand = Math.floor(Math.random() * peers.length)
        const ip = peers[rand]
        if(!this.connected[ip]){
          const peer = this.peers[ip]
          try {
            const client = new Client(peer.ip, peer.port)
            await client.init()
            client.subscribe(this)
            client.sendVersion()
          } catch(error) {
            this.banPeer(ip)
            // console.log('connection refused to '+peer.ip+':'+peer.port)
            // console.log(error)
          }
        }
      }
      const subscriber = this.subscribers['networkconnected']
      if(subscriber) {
        setTimeout(() => subscriber.connected(), 0)
      }
    }
  }

  async getRandomConnectedPeer() {
    const clients = Object.values(this.connected)
    const rand = Math.floor(Math.random() * clients.length)
    if(clients[rand].verack) {
      return clients[rand]
    } else {
      await new Promise((resolve)=> setTimeout(resolve, 1000))
      return this.getRandomConnectedPeer()
    }
  }

  async getRandomConnectedPeers(min) {
    const result = {}
    while(Object.keys(result).length < min) {
      const client = await this.getRandomConnectedPeer()
      result[client.address] = client
    }
    return Object.values(result)
  }

  async getBlockTransactions(hashes) {
    return new Promise(async (resolve, reject) => {
      this.downloader = {blocks:{}}
      hashes.forEach(hash => this.downloader.blocks[hash]='placeholder')
      this.downloader.resolve = resolve
      // console.log(this.promises)
      hashes.forEach(async hash => {
        const peers = await this.getRandomConnectedPeers(6)
        peers.forEach(client => client.sendGetdata([{type: 2, hash}]))
      })
      this.downloader.timeout = setTimeout(() => reject('timeout to get block'), 5000)
    })
  }

  async sendGetheaders(hash) {
    const client = await this.getRandomConnectedPeer()
    client.sendGetheaders(hash)
  }

  receiveMessages(client, messages) {
    for(let i = 0; i < messages.length; i++) {
      const message = messages[i]
      logger.debug('  => '+message.header.type+' from '+client.address+':'+client.port)
      switch(message.header.type) {
        case 'ping':
          client.sendPong()
          break
        case 'version':
          client.sendVerack()
          client.sendSendheaders()
          break
        case 'verack':
          this.connected[client.address] = client
          client.sendGetaddr()
          break
        case 'addr':
          for(let i = 0; i < message.payload.addresses.length; i++) {
            this.addPeer(message.payload.addresses[i])
          }
          logger.debug('Parsed '+message.payload.addresses.length+' new IP(s)')
          logger.debug('Network contains now '+Object.keys(this.peers).length + ' peers')
          logger.debug('Connected to '+Object.keys(this.connected).length + ' peers')
          break
        case 'inv':
          logger.debug('     inventory of '+message.payload.vectors.length+' new vectors')
          break
        case 'block':
          const downloader = this.downloader
          if(downloader && message.payload){
            const hash = message.payload.hash
            if(downloader.blocks[hash] === 'placeholder') downloader.blocks[hash] = message.payload
            const blocks = Object.values(downloader.blocks)
            if(!blocks.find(b => b === 'placeholder')){
              delete this.downloader
              clearTimeout(downloader.timeout)
              setTimeout(() => downloader.resolve(blocks), 0)
            }
          }
        default:
      }
      if(this.subscribers[message.header.type]) {
        const that = this
        setTimeout(() => that.subscribers[message.header.type].receive(message),0)
      }
      if(this.subscribers['all']) {
        const that = this
        setTimeout(() => that.subscribers['all'].receive(message),0)
      }
    }
  }
}

Network.fromSeed = async (ip, port) => {
  const network = new Network()
  network.peers[ip] = {ip, port}
  const client = new Client(ip, port)
  await client.init()
  client.sendVersion()
  network.connected[ip] = client
  network.connected[ip].subscribe(network)
  return network
}


module.exports = Network