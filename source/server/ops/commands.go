package ops

import (
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/spf13/cobra"
)

// RegisterCommands adds container-friendly operational commands to PocketBase's CLI.
func RegisterCommands(application core.App, root *cobra.Command) {
	root.AddCommand(newHealthcheckCommand())
	root.AddCommand(newBackupCommand(application))
}

func newHealthcheckCommand() *cobra.Command {
	defaultURL := os.Getenv("LASTDONE_HEALTH_URL")
	if defaultURL == "" {
		defaultURL = "http://127.0.0.1:8090"
	}
	var healthURL string
	command := &cobra.Command{
		Use:   "healthcheck",
		Short: "Check whether the LastDone HTTP server is ready",
		Args:  cobra.NoArgs,
		RunE: func(command *cobra.Command, _ []string) error {
			client := &http.Client{Timeout: 5 * time.Second}
			return CheckHealth(command.Context(), client, healthURL)
		},
	}
	command.Flags().StringVar(&healthURL, "url", defaultURL, "LastDone server base or health URL")
	return command
}

func newBackupCommand(application core.App) *cobra.Command {
	return &cobra.Command{
		Use:   "backup",
		Short: "Create a manual LastDone backup",
		Args:  cobra.NoArgs,
		RunE: func(command *cobra.Command, _ []string) error {
			if err := application.Bootstrap(); err != nil {
				return fmt.Errorf("bootstrap application: %w", err)
			}
			defer application.ResetBootstrapState()
			manager := BackupManager{
				DataDir: application.DataDir(),
				Create:  application.CreateBackup,
			}
			name, err := manager.CreateManual(command.Context())
			if err != nil {
				return err
			}
			_, err = fmt.Fprintln(command.OutOrStdout(), name)
			return err
		},
	}
}
