export default function PageLoading() {
  return (
    <div
      className="page-loading"
      role="status"
      aria-label="Loading tender information"
    >
      <span className="ui-sr-only">
        Reading the latest tender information from NEAR.
      </span>
      <div className="loading-bar loading-bar--title" />
      <div className="loading-bar loading-bar--copy" />
      <div className="loading-panels">
        {[0, 1, 2].map((id) => (
          <div className="loading-panel" key={id}>
            <div className="loading-bar" />
            <div className="loading-bar" />
            <div className="loading-bar loading-bar--copy" />
          </div>
        ))}
      </div>
    </div>
  );
}
