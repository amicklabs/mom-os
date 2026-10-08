import QtQuick
import QtQuick.Controls as QQC
import QtQuick.Layouts
import qs.Commons
import qs.Ui

// The inside of the MomOS panel. `host` is the bar widget (Panel.qml), which
// holds the dispatcher's summary and makes the requests. Kept separate so it
// can be rendered on its own for testing.
FocusScope {
  id: content

  property var host: null
  readonly property real contentHeight: column.implicitHeight

  function send() {
    var text = messageField.text.trim()
    if (text === "") return
    host.act("say", "say", { text: text }, "Sent. It's on the laptop's screen now.")
    messageField.text = ""
  }

  FocusScope {
    id: keyScope
    anchors.fill: parent
    focus: true
    Keys.onEscapePressed: host.close()

    Flickable {
      id: flick
      anchors.fill: parent
      contentWidth: width
      contentHeight: column.implicitHeight
      clip: true
      boundsBehavior: Flickable.StopAtBounds
      interactive: contentHeight > height
      QQC.ScrollBar.vertical: QQC.ScrollBar { policy: QQC.ScrollBar.AsNeeded }

      Column {
        id: column
        width: flick.width
        spacing: Style.space(12)

        // Header
        Column {
          width: parent.width
          spacing: Style.space(2)
          Text {
            textFormat: Text.PlainText
            width: parent.width
            text: host.reachable && host.summary ? host.summary.title : "MomOS"
            color: host.foreground
            font.family: host.fontFamily
            font.pixelSize: Style.font.heading
            font.bold: true
            elide: Text.ElideRight
          }
          Text {
            textFormat: Text.PlainText
            width: parent.width
            text: !host.reachable ? "Dispatcher not running" : (host.summary ? host.summary.label : "")
            color: !host.reachable || (host.summary && host.summary.attention) ? host.urgent : host.dim
            font.family: host.fontFamily
            font.pixelSize: Style.font.body
            wrapMode: Text.WordWrap
          }
        }

        // Dispatcher down: say how to start it and nothing else.
        Text {
          visible: !host.reachable
          textFormat: Text.PlainText
          width: parent.width
          text: "Start it with: systemctl --user start momos-dispatcher\nLogs: journalctl --user -u momos-dispatcher"
          color: host.dim
          font.family: host.fontFamily
          font.pixelSize: Style.font.bodySmall
          wrapMode: Text.WordWrap
        }

        // Screenshot
        Item {
          visible: host.reachable
          width: parent.width
          height: Math.round(width * 768 / 1366)

          Rectangle {
            anchors.fill: parent
            color: Qt.rgba(host.foreground.r, host.foreground.g, host.foreground.b, 0.05)
            radius: Style.cornerRadius
          }
          Image {
            id: shot
            anchors.fill: parent
            anchors.margins: 1
            fillMode: Image.PreserveAspectFit
            asynchronous: true
            cache: false
            source: host.summary && host.summary.screenshot ? "file://" + host.summary.screenshot.path + "?n=" + host.imageNonce + "&w=" + encodeURIComponent(host.summary.screenshot.when) : ""
          }
          Text {
            anchors.centerIn: parent
            visible: shot.status !== Image.Ready
            textFormat: Text.PlainText
            text: host.busyAction === "screenshot" ? "Taking a screenshot…" : "No screenshot yet"
            color: host.dim
            font.family: host.fontFamily
            font.pixelSize: Style.font.body
          }
        }

        RowLayout {
          visible: host.reachable
          width: parent.width
          Text {
            Layout.fillWidth: true
            textFormat: Text.PlainText
            text: host.summary && host.summary.screenshot ? "Screenshot " + host.summary.screenshot.when : ""
            color: host.dim
            font.family: host.fontFamily
            font.pixelSize: Style.font.caption
          }
          PanelActionButton {
            iconText: "󰄀"
            tooltipText: "Take a new screenshot"
            foreground: host.foreground
            fontFamily: host.fontFamily
            enabled: host.busyAction === ""
            onClicked: host.act("screenshot", "screenshot", { refresh: true }, "")
          }
        }

        // Status lines
        Column {
          visible: host.reachable && host.summary && host.summary.lines.length > 0
          width: parent.width
          spacing: Style.space(3)
          Repeater {
            model: host.summary ? host.summary.lines : []
            Text {
              required property var modelData
              textFormat: Text.PlainText
              width: parent ? parent.width : 0
              text: modelData
              color: host.foreground
              font.family: host.fontFamily
              font.pixelSize: Style.font.bodySmall
              wrapMode: Text.WordWrap
            }
          }
        }

        // Actions
        GridLayout {
          visible: host.reachable
          width: parent.width
          columns: 3
          columnSpacing: Style.space(6)
          rowSpacing: Style.space(6)

          Button {
            Layout.fillWidth: true
            bordered: true
            text: "Open screen"
            foreground: host.foreground
            fontFamily: host.fontFamily
            enabled: host.busyAction === ""
            onClicked: host.act("vnc", "vnc", {}, "Opening the laptop's screen. It shows a banner while you're connected.")
          }
          Button {
            Layout.fillWidth: true
            bordered: true
            text: host.busyAction === "investigate" ? "Starting…" : "Investigate"
            foreground: host.foreground
            fontFamily: host.fontFamily
            enabled: host.busyAction === "" && host.summary !== null && host.summary.deviceId !== null
            onClicked: host.act("investigate", "investigate", {}, "An agent is looking into it.")
          }
          Button {
            Layout.fillWidth: true
            bordered: true
            text: "Approve fix"
            foreground: host.summary && host.summary.approvableJobId ? host.urgent : host.foreground
            fontFamily: host.fontFamily
            enabled: host.busyAction === "" && host.summary !== null && host.summary.approvableJobId !== null
            onClicked: host.act("approve", "approve", { jobId: host.summary.approvableJobId }, "Approved. The agent will carry out the fix.")
          }
        }

        RowLayout {
          visible: host.reachable
          width: parent.width
          spacing: Style.space(6)
          TextField {
            id: messageField
            Layout.fillWidth: true
            placeholderText: "Send a message to the laptop's screen"
            foreground: host.foreground
            maximumLength: 280
            onAccepted: content.send()
            Keys.onEscapePressed: host.close()
          }
          Button {
            bordered: true
            text: "Send"
            foreground: host.foreground
            fontFamily: host.fontFamily
            enabled: host.busyAction === "" && messageField.text.trim() !== ""
            onClicked: content.send()
          }
        }

        Text {
          visible: host.feedback !== ""
          textFormat: Text.PlainText
          width: parent.width
          text: host.feedback
          color: host.feedbackIsError ? host.urgent : host.dim
          font.family: host.fontFamily
          font.pixelSize: Style.font.bodySmall
          wrapMode: Text.WordWrap
        }

        // Help requests
        PanelSeparator {
          visible: host.reachable && host.summary && host.summary.helpRequests.length > 0
          foreground: host.foreground
        }
        PanelSectionHeader {
          visible: host.reachable && host.summary && host.summary.helpRequests.length > 0
          text: "HELP REQUESTS"
          foreground: host.foreground
          fontFamily: host.fontFamily
        }
        Repeater {
          model: host.reachable && host.summary ? host.summary.helpRequests : []
          Text {
            required property var modelData
            textFormat: Text.PlainText
            width: column.width
            text: modelData.text + " · " + modelData.when
            color: host.urgent
            font.family: host.fontFamily
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
          }
        }

        // Jobs
        PanelSeparator {
          visible: host.reachable && host.summary && host.summary.jobs.length > 0
          foreground: host.foreground
        }
        PanelSectionHeader {
          visible: host.reachable && host.summary && host.summary.jobs.length > 0
          text: "AGENT JOBS"
          foreground: host.foreground
          fontFamily: host.fontFamily
        }
        Repeater {
          model: host.reachable && host.summary ? host.summary.jobs : []
          Column {
            required property var modelData
            width: column.width
            spacing: Style.space(1)
            Text {
              textFormat: Text.PlainText
              width: parent.width
              text: modelData.statusLabel + " · " + modelData.when
              color: modelData.canApprove ? host.urgent : host.foreground
              font.family: host.fontFamily
              font.pixelSize: Style.font.bodySmall
              font.bold: true
              elide: Text.ElideRight
            }
            Text {
              textFormat: Text.PlainText
              width: parent.width
              text: modelData.excerpt
              color: host.dim
              font.family: host.fontFamily
              font.pixelSize: Style.font.caption
              wrapMode: Text.WordWrap
              maximumLineCount: 3
              elide: Text.ElideRight
            }
          }
        }
      }
    }
  }
}
