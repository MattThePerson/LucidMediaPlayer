//go:build linux || darwin

package main

func initTray(_ *App) error  { return nil }
func destroyTray(_ *App)     {}
func updateTrayTooltip(_ *App) {}
