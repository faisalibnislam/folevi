// The scripted demo engine lives in its own target (FoleviEngineDemo, files in Demo/) so Folevi Core can use it
// too; FoleviMac re-exports it, so its users keep writing `import FoleviMac`.
@_exported import FoleviEngineDemo
