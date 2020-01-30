'use strict';

const net = require('net');
const crypto = require('crypto')
const ip = require('ip')
const bitcoinjs = require('bitcoinjs-lib')
const logger = require('./logger')

const checksum = (buffer) => {
  return doublehash(buffer).slice(0,4)
}

const doublehash = (buffer) => {
  const temp = crypto.createHash('sha256').update(buffer).digest()
  return crypto.createHash('sha256').update(temp).digest()
}

const reverseInplace = (buffer) => {
  for (var i = 0, j = buffer.length - 1; i < j; ++i, --j) {
    var t = buffer[j]

    buffer[j] = buffer[i]
    buffer[i] = t
  }

  return buffer
}

const readVarString = (buffer) => {
  const {value, int_length} = readVarInt(buffer)
  const var_string = buffer.slice(int_length, int_length + value).toString('ascii')
  return {
    var_string,
    var_length: value + int_length
  }
}

const getVarString = (string) => {
  const bufferint = getVarInt(string.length)
  const buffer = Buffer.allocUnsafe(bufferint.length + string.length)
  buffer.write(bufferint.toString('hex'), 'hex')
  buffer.write(string, bufferint.length, 'ascii')

  return buffer
}


const getVarInt = (value) => {
  let buffer
  if(value < 0xFD) {
    buffer = Buffer.allocUnsafe(1)
    buffer.writeUInt8(value)
  } else if(value <= 0xFFFF) {
    buffer = Buffer.allocUnsafe(3)
    buffer.writeUInt8(0xFD)
    buffer.writeUInt16LE(value,1)
  } else if(value <= 0xFFFFFFFF) {
    buffer = Buffer.allocUnsafe(5)
    buffer.writeUInt8(0xFE)
    buffer.writeUInt32LE(value,1)
  } else {
    buffer = Buffer.allocUnsafe(9)
    buffer.writeUInt8(0xFF)
    buffer.writeBigUInt64LE(value * 1n, 1)
  }
  return buffer
}

const readVarInt = (buffer) => {
  if(buffer[0] < 0xFD) {
    return {
      value: buffer.readUInt8(0),
      int_length: 1
    }
  } else if(buffer[0] === 0xFD) {
    return {
      value: buffer.readUInt16LE(1),
      int_length: 3
    }
  } else if(buffer[0] === 0xFE) {
    return {
      value: buffer.readUInt32LE(1),
      int_length: 5
    }
  } else if(buffer[0] === 0xFF) {
    return {
      value: Number(buffer.readBigUInt64LE(1)),
      int_length: 9
    }
  }
}


class Client {
  constructor(address, port) {
    this.socket = new net.Socket()
    this.address = address
    this.port = port
    this.stats = {}
    this.net_addr = Buffer.allocUnsafe(26)
    this.net_addr.writeUInt32LE(0)
    this.net_addr.write('00000000000000000000ffff', 8, 'hex')
    this.net_addr.write(ip.toBuffer(this.address).toString('hex'), 20, 'hex')
    this.net_addr.writeUInt16BE(port, 24)
    this.net_addr = this.net_addr.toString('hex')
  }

  async init() {
    var client = this;
    return new Promise((resolve, reject) => {
      client.socket.connect(client.port, client.address, () => resolve(`Client connected to: ${client.address}:${client.port}`))
      var t = setTimeout(() => {
        client.socket.destroy()
        reject('Client timeout')
      }, 500)
      client.socket.once('connect', () => clearTimeout(t))
      client.socket.on('error', (error) => reject('Client rejected '+JSON.stringify(error)))
      client.socket.on('close', () => reject('Client closed'))
      client.socket.on('data', (data) => {
        try {
          const messages = client.read(Buffer.from(data))
          if(this.wakeup) {
            this.wakeup(messages)
            this.wakeup = null
          }
          if(this.subscriber) {
            const that = this
            setTimeout(() => that.subscriber.receiveMessages(that, messages),0)
          }
        } catch(error) {

        }
      })
    })
  }

  subscribe(subscriber) {
    this.subscriber = subscriber
  }

  readHeader(buffer) {
    const magic = buffer.slice(0,4).toString('hex')
    const type = buffer.slice(4,16).toString('ascii').split('\u0000')[0]
    const length = buffer.readUInt32LE(16)
    const check = buffer.slice(20,24).toString('hex')
    // console.log(calcchecksum, check)
    return {
      magic,
      type,
      length,
      checksum: check
    }
  }

  readSendcmpct(payload) {
    const bool = payload.readUInt8()
    const data = payload.readBigInt64LE(1)
    return {
      bool,
      data
    }
  }

  readInv(payload) {
    const varint = readVarInt(payload)
    const vectors = []
    for(let i = 0 ; i < varint.value; i++) {
      const vector = {}
      vector.type = payload.readUInt16LE(varint.int_length + i*36)
      vector.hash = reverseInplace(payload.slice(varint.int_length + i*36 + 4, varint.int_length + i*36 + 36)).toString('hex')
      vectors.push(vector)
    }
    return {
      vectors
    }
  }

  readAddr(payload) {
    const varint = readVarInt(payload)
    const addresses = []
    for(let i = 0 ; i < varint.value; i++) {
      const addr = {}
      if(this.version.protocol >= 31402) {
        addr.timestamp = new Date(payload.readUInt32LE(varint.int_length + i*30) * 1000)
        addr.services = payload.readBigUInt64LE(varint.int_length + i*30 + 4)
        addr.ip = ip.toString(payload.slice(varint.int_length + i*30 + 12, varint.int_length + i*30 + 28))
        addr.port = payload.readUInt16BE(varint.int_length + i*30 + 28)
      }
      addresses.push(addr)
    }

    return {
      addresses
    }
  }

  readHeaders(payload) {
    const varint = readVarInt(payload)
    const headers = []
    for(let i = 0 ; i < varint.value; i++) {
      const header = {}
      header.raw = payload.slice(varint.int_length + i*81, varint.int_length + i*81 + 80).toString('hex')
      header.hash = reverseInplace(doublehash(payload.slice(varint.int_length + i*81, varint.int_length + i*81 + 80))).toString('hex')
      headers.push(header)
    }

    return {
      headers
    }
  }

  readBlock(payload) {
    return bitcoinjs.Block.fromBuffer(payload)
  }

  readTransaction(payload) {
    return bitcoinjs.Transaction.fromBuffer(payload)
  }

  readVersion(message) {
    const protocol = message.readInt32LE(0)
    const service = message.readBigUInt64LE(4)
    const timestamp = new Date(Number(message.readBigInt64LE(12) * 1000n))
    // my ip
    const addr_recv = ip.toString(message.slice(40,44)) // ipv4
    const port_recv = message.readUInt16BE(44)
    // peer ip
    const addr_from = ip.toString(message.slice(66,70)) // ipv4
    const port_from = message.readUInt16BE(70)
    const nonce = message.readBigUInt64LE(72)
    const {var_string, var_length} = readVarString(message.slice(80))
    const user_agent = var_string
    const start_height = message.readInt32LE(80+var_length)
    const relay = message.readUInt8(80+var_length)

    return {
      protocol,
      service,
      timestamp,
      addr_recv,
      port_recv,
      addr_from,
      port_from,
      nonce,
      user_agent,
      start_height,
      relay,
    }
  }

  read(data) {
    let buffer = data
    if(data.length < 24) {
      if(this.lastdata) {
        buffer = Buffer.concat([this.lastdata, data])
        return this.read(buffer)
      } else {
        this.lastdata = data
        return []
      }
    }
    const message = {}
    try{
      message.header = this.readHeader(buffer)
    } catch (error){
      logger.error('cannot read header of '+ buffer.toString('hex'))
      return []
    }
    if(message.header.magic === 'f9beb4d9') {
      this.lastdata = buffer
    } else {
      if(this.lastdata) {
        buffer = Buffer.concat([this.lastdata, data])
        return this.read(buffer)
      }
      else { // lost TODO: try to lock to the next occurence of magic
        return []
      }
    }
    if(message.header.length + 24 > buffer.length) {
      return []
    } else switch(message.header.type){
      case 'version':
        message.payload = this.readVersion(buffer.slice(24, 24 + message.header.length))
        this.version = message.payload
        break
      case 'verack':
        this.verack = true
        break
      case 'headers':
        this.addStats('headers')
        message.payload = this.readHeaders(buffer.slice(24, 24 + message.header.length))
        break
      case 'block':
        message.payload = this.readBlock(buffer.slice(24, 24 + message.header.length))
        message.payload.hash = reverseInplace(message.payload.getHash()).toString('hex')
        break
      case 'ping':
        message.payload = buffer.slice(24, 24 + message.header.length).readBigUInt64LE()
        this.lastPing = message
        break
      case 'addr':
        this.addStats('addr')
        message.payload = this.readAddr(buffer.slice(24, 24 + message.header.length))
        break
      case 'inv':
        message.payload = this.readInv(buffer.slice(24, 24 + message.header.length))
        break
      default:
    }
    const nextmessage = buffer.slice(24 + message.header.length)
    if(nextmessage.length > 0) {
      return [message,...this.read(nextmessage)]
    } else {
      return [message]
    }
    
  }

  sendGetaddr() {
    let message = "f9beb4d9"
    message += Buffer.from('getaddr','ascii').toString('hex') + '0000000000'
    message += '00000000'
    message += '5df6e0e2'

    return this.sendMessage('getaddr', Buffer.from(message,'hex'))
  }

  sendSendheaders() {
    let message = "f9beb4d9"
    message += Buffer.from('sendheaders','ascii').toString('hex') + '00'
    message += '00000000'
    message += '5df6e0e2'

    return this.sendMessage('sendheaders', Buffer.from(message,'hex'))
  }

  sendGetdata(vectors) {
    const varint = getVarInt(vectors.length)
    const message_length = varint.length + 36*vectors.length
    let message = Buffer.allocUnsafe(24 + message_length)
    message.write('f9beb4d9', 'hex')
    message.write('getdata', 4, 'ascii')
    message.write('0000000000', 11, 'hex')
    message.writeUInt32LE(message_length, 16)
    message.write(varint.toString('hex'), 24, 'hex')
    let start = 24 + varint.length
    vectors.forEach((vector) => {
      message.writeUInt32LE(vector.type, start)
      message.write(reverseInplace(Buffer.from(vector.hash, 'hex')).toString('hex'), start + 4, 'hex')
    })

    message.write(checksum(message.slice(24)).toString('hex'), 20, 'hex')
    return this.sendMessage('getdata', Buffer.from(message,'hex'))
  }

  sendGetblocks(hash) {
    let header = Buffer.allocUnsafe(24 + 69)
    header.write('f9beb4d9', 'hex')
    header.write('getblocks', 4, 'ascii')
    header.write('000000', 13, 'hex')
    header.writeUInt32LE(69, 16)
    header.writeUInt32LE(this.version.protocol, 24)
    header.write(getVarInt(1).toString('hex'), 28, 'hex')
    header.write(reverseInplace(Buffer.from(hash, 'hex')), 29, 'hex')
    header.write('0000000000000000000000000000000000000000000000000000000000000000', 61, 'hex')
    header.write(checksum(header.slice(24)).toString('hex'), 20, 'hex')
    return this.sendMessage('getblocks', header)
  }

  sendGetheaders(hash) {
    let header = Buffer.allocUnsafe(24 + 69)
    header.write('f9beb4d9', 'hex')
    header.write('getheaders', 4, 'ascii')
    header.write('0000', 14, 'hex')
    header.writeUInt32LE(69, 16)
    header.writeUInt32LE(this.version.protocol, 24)
    header.write(getVarInt(1).toString('hex'), 28, 'hex')
    header.write(reverseInplace(Buffer.from(hash, 'hex')).toString('hex'), 29, 'hex')
    header.write('0000000000000000000000000000000000000000000000000000000000000000', 61, 'hex')
    header.write(checksum(header.slice(24)).toString('hex'), 20, 'hex')
    return this.sendMessage('getheaders', header)
  }

  sendVerack() {
    let header = Buffer.allocUnsafe(24)
    header.write('f9beb4d9', 'hex')
    header.write('verack', 4, 'ascii')
    header.write('000000000000', 10, 'hex')
    header.writeUInt32LE(0, 16)
    header.write('5df6e0e2', 20, 'hex')

    return this.sendMessage('verack', header)
  }

  sendPong() {
    let header = Buffer.allocUnsafe(24 + 8)
    header.write('f9beb4d9', 'hex')
    header.write('pong', 4, 'ascii')
    header.write('0000000000000000', 8, 'hex')
    header.writeUInt32LE(8, 16)
    header.writeBigUInt64LE(1n, 24)
    header.write(checksum(header.slice(24)).toString('hex'), 20, 'hex')

    return this.sendMessage('pong', header)
  }

  sendVersion() {
    let header = Buffer.allocUnsafe(24)
    header.write('f9beb4d9', 'hex')
    header.write('version', 4, 'ascii')
    header.write('0000000000', 11, 'hex')

    let payload = Buffer.allocUnsafe(250)
    payload.writeInt32LE(70015, 0)
    payload.writeBigUInt64LE(0n, 4)
    payload.writeBigInt64LE(BigInt(Date.now())/1000n, 12)
    payload.write(this.net_addr, 20, 'hex')
    payload.write('0000000000000000', 46, 'hex')
    payload.write('00000000000000000000ffff0000000000', 54, 'hex')
    payload.writeBigUInt64LE(1n, 72)
    const var_string = getVarString('/lwabn:0.0.1/')
    payload.write(var_string.toString('hex'), 80, 'hex')
    payload.writeInt32LE(0, 80 + var_string.length)
    payload.writeUInt8(0,84 + var_string.length)

    payload = payload.slice(0, 85+var_string.length)

    header.writeUInt32LE(payload.length, 16)
    header.write(checksum(payload).toString('hex'), 20, 'hex')

    const message = header.toString('hex') + payload.toString('hex')
    
    return this.sendMessage('version', Buffer.from(message, 'hex'))
    
  }

  sleep() {
    return new Promise((resolve) => {
      this.wakeup = resolve
    })
  }

  addStats(message) {
    if(!this.stats[message]){
      this.stats[message]=0
    }
    this.stats[message]++
  }

  getScore(message) {
    if(this.stats['get'+message] && this.stats[message] && this.stats[message] > 3){
      return this.stats[message]/this.stats['get'+message]
    }
    else return 1
  }


  sendMessage(type, message) {
    logger.debug('<=   ' +type+' to '+ this.address+':'+this.port)
    this.addStats(type)
    this.socket.write(message)
  }
}
module.exports = Client