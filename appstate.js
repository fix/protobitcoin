const fs = require('fs')

class AppState {
  constructor(file){
    this.file = file
    this.state = require(file)
  }
  save() {
    fs.writeFile(this.file, JSON.stringify(this.state, null, 2))
  }
  set(key, value){
    this.state[key] = value
  }
  get(key){
    return this.state[key]
  }
}

module.exports = AppState
