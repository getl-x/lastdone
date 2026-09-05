package main

import (
	"log"

	lastdoneapp "github.com/getl-x/lastdone/source/server/app"
	_ "github.com/getl-x/lastdone/source/server/migrations"
	"github.com/getl-x/lastdone/source/server/ops"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
)

func main() {
	config := lastdoneapp.DefaultConfig()
	application := lastdoneapp.New(config)
	migratecmd.MustRegister(application, application.RootCmd, migratecmd.Config{})
	ops.RegisterCommands(application, application.RootCmd)

	if err := application.Start(); err != nil {
		log.Fatal(err)
	}
}
