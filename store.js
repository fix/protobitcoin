const Sequelize = require('sequelize')
const {Block, UTXO} = require('./block')
const AppState = require('./appstate')


class Store {
  constructor() {
    const sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: './blockchain.sqlite',
      logging: null
    })
    Block.init(Block.schema, {
      sequelize,
      timestamps: false
    })
    Block.sync()
    UTXO.init(UTXO.schema, {
      sequelize,
      timestamps: false
    })
    UTXO.sync()
    this.block = Block
    this.utxo = UTXO
    this.state = new AppState('./state.json')
  }
}

Store.instance = () => {
  if(!Store.that) {
    Store.that = new Store()
  }
  return Store.that
}

module.exports = Store.instance()