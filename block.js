const Sequelize = require('sequelize')

const reverseInplace = (buffer) => {
  for (var i = 0, j = buffer.length - 1; i < j; ++i, --j) {
    var t = buffer[j]
    buffer[j] = buffer[i]
    buffer[i] = t
  }
  return buffer
}

class Block extends Sequelize.Model {
  
}

Block.readRawHeader = (payload) => {
  const header = {}
  header.version = payload.readInt32LE(0)
  header.prev_block = reverseInplace(payload.slice(4, 36)).toString('hex')
  header.merkle_root = reverseInplace(payload.slice(36, 68)).toString('hex')
  header.timestamp = payload.readUInt32LE(68)
  header.bits = payload.readUInt32LE(72)
  header.nonce = payload.readUInt32LE(76)
  return header
}

Block.schema = {
  raw: {
    type: Sequelize.BLOB('tiny'),
    get() {
      return  this.getDataValue('raw').toString('hex')
    },
    set(val) {
      this.setDataValue('raw', Buffer.from(val,'hex'))
    }
  },
  hash: {
    type:  Sequelize.BLOB('tiny'),
    get() {
      return  this.getDataValue('hash').toString('hex')
    },
    set(val) {
      this.setDataValue('hash', Buffer.from(val,'hex'))
    }
  },
  height: {
    type: Sequelize.INTEGER,
    unique: true
  }
}

class UTXO extends Sequelize.Model {
  
}

UTXO.schema = {
  hash: {
    type: Sequelize.BLOB('tiny'),
    get() {
      return  this.getDataValue('hash').toString('hex')
    },
    set(val) {
      this.setDataValue('hash', Buffer.from(val,'hex'))
    }
  },
  script: {
    type: Sequelize.BLOB('tiny'),
    get() {
      return  this.getDataValue('script').toString('hex')
    },
    set(val) {
      this.setDataValue('script', Buffer.from(val,'hex'))
    }
  },
  index: {
    type:  Sequelize.INTEGER
  },
  timelock: {
    type: Sequelize.INTEGER
  }
}

module.exports = {
  Block,
  UTXO
}
