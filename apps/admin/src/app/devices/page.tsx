"use client";

import { api } from "@momos/backend/convex/_generated/api";
import { useAction, useMutation } from "convex/react";
import { useState } from "react";
import { displayName, useDevices, type DeviceSummary } from "@/components/device-context";
import { Badge, Button, Card, Empty, ErrorText, Field, Loading, useNow, useRun } from "@/components/ui";
import { ago, isOnline, when } from "@/lib/format";

export default function DevicesPage() {
  const { devices } = useDevices();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Devices</h1>
      <CreateDevice />
      {devices === undefined ? (
        <Loading />
      ) : devices.length === 0 ? (
        <Empty>No devices yet.</Empty>
      ) : (
        devices.map((d) => <DeviceRow key={d._id} device={d} />)
      )}
    </div>
  );
}

function CreateDevice() {
  const create = useAction(api.admin.createDevice);
  const [name, setName] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { busy, error, run } = useRun();

  if (token) {
    return (
      <Card title="Device created">
        <p className="text-sm text-stone-600 dark:text-stone-400">
          This token is shown once. Put it in <code>~/.config/momos/device-token</code> on the laptop (mode 600). If you
          lose it, revoke the device and create a new one.
        </p>
        <code className="mt-3 block break-all rounded-lg bg-stone-100 p-3 font-mono text-sm select-all dark:bg-stone-800">{token}</code>
        <div className="mt-3 flex gap-2">
          <Button
            variant="primary"
            onClick={async () => {
              await navigator.clipboard.writeText(token);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy token"}
          </Button>
          <Button
            onClick={() => {
              setToken(null);
              setCopied(false);
            }}
          >
            Done
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Add a device">
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const res = await run(() => create({ name }));
          if (res) {
            setToken(res.token);
            setName("");
          }
        }}
      >
        <Field label="Name" hint="Something you'll recognize, like the laptop's hostname.">
          <input value={name} maxLength={64} onChange={(e) => setName(e.target.value)} placeholder="mom-laptop" />
        </Field>
        <Button type="submit" variant="primary" disabled={busy || !name.trim()} className="self-start">
          Create device
        </Button>
        <ErrorText error={error} />
      </form>
    </Card>
  );
}

function DeviceRow({ device }: { device: DeviceSummary }) {
  const revoke = useMutation(api.admin.revokeDevice);
  const now = useNow();
  const { busy, error, run } = useRun();
  const revoked = device.revokedAt !== null;
  const online = isOnline(device.lastSeenAt, now);
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {displayName(device)}
          {revoked ? <Badge tone="red">Revoked</Badge> : <Badge tone={online ? "green" : "gray"}>{online ? "Online" : "Offline"}</Badge>}
        </span>
      }
    >
      <p className="text-sm text-stone-500">
        Created {when(device.createdAt)}.{" "}
        {device.lastSeenAt ? `Last heard from ${ago(device.lastSeenAt, now)}.` : "Never connected."}
        {revoked && device.revokedAt ? ` Revoked ${when(device.revokedAt)}.` : ""}
      </p>
      {!revoked && (
        <Button
          variant="danger"
          className="mt-3"
          disabled={busy}
          onClick={() => {
            if (confirm(`Revoke ${device.name}? Its token stops working at once.`)) void run(() => revoke({ deviceId: device._id }));
          }}
        >
          Revoke
        </Button>
      )}
      <ErrorText error={error} />
    </Card>
  );
}
