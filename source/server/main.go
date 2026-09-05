package main

import (
	"log"

	lastdoneapp "github.com/getl-x/lastdone/source/server/app"
	_ "github.com/getl-x/lastdone/source/server/migrations"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
)

func main() {
	application := lastdoneapp.New(lastdoneapp.DefaultConfig())
	migratecmd.MustRegister(application, application.RootCmd, migratecmd.Config{})

	if err := application.Start(); err != nil {
		log.Fatal(err)
	}
}
