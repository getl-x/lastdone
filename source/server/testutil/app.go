package testutil

import (
	"testing"

	lastdoneapp "github.com/getl-x/lastdone/source/server/app"
	"github.com/pocketbase/pocketbase"
)

func NewApp(t testing.TB) *pocketbase.PocketBase {
	t.Helper()

	return lastdoneapp.New(lastdoneapp.Config{
		DataDir:    t.TempDir(),
		PublicDir:  t.TempDir(),
		AppVersion: "test",
	})
}
