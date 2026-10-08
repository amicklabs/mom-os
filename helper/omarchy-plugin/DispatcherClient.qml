import QtQuick
import Quickshell
import Quickshell.Io

// Transport only: sends JSON-lines requests to the MomOS dispatcher socket
// and hands each response to its callback. The dispatcher does all the
// thinking; if its socket is missing, every request fails with
// "Dispatcher not running".
Item {
  id: client

  property string path: Quickshell.env("XDG_RUNTIME_DIR") + "/momos-dispatcher.sock"
  // True once a request got through; false after the socket goes away.
  property bool available: false

  property int _nextId: 1
  property var _callbacks: ({})
  property var _queue: []

  function request(cmd, args, callback) {
    var id = _nextId++
    _callbacks[id] = callback || null
    var line = JSON.stringify({ cmd: cmd, args: args || {}, id: id }) + "\n"
    if (sock.connected) {
      sock.write(line)
      sock.flush()
    } else {
      _queue.push(line)
      sock.connected = true
    }
  }

  function _failAll(message) {
    var cbs = _callbacks
    _callbacks = ({})
    _queue = []
    for (var id in cbs) {
      if (cbs[id]) cbs[id]({ ok: false, error: message })
    }
  }

  Socket {
    id: sock
    path: client.path

    onConnectedChanged: {
      if (connected) {
        client.available = true
        var q = client._queue
        client._queue = []
        for (var i = 0; i < q.length; i++) write(q[i])
        flush()
      } else {
        client._failAll("Dispatcher not running")
      }
    }

    onError: function(error) {
      client.available = false
      client._failAll("Dispatcher not running")
    }

    parser: SplitParser {
      onRead: function(line) {
        var msg
        try { msg = JSON.parse(line) } catch (e) { return }
        var cb = client._callbacks[msg.id]
        delete client._callbacks[msg.id]
        if (cb) cb(msg)
      }
    }
  }
}
