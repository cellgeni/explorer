// Offered with an `app-updated` error: reloading fetches the app's new
// version (staleChunk.ts).
export function ReloadAppButton() {
  return (
    <button
      type="button"
      className="secondary-action"
      title="Reload the page to load the updated app"
      onClick={() => {
        window.location.reload()
      }}
    >
      Reload
    </button>
  )
}
