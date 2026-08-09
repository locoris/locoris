export function selectReleaseByTag({
  directRelease,
  listedReleases = [],
  releaseTag,
  allowDraft = false
}) {
  const release = directRelease?.tag_name === releaseTag
    ? directRelease
    : listedReleases.find((candidate) => candidate?.tag_name === releaseTag);

  if (!release) {
    throw new Error(`Release ${releaseTag} was not found.`);
  }
  if (release.draft && !allowDraft) {
    throw new Error(`Release ${releaseTag} is still a draft.`);
  }
  if (release.prerelease) {
    throw new Error(`Release ${releaseTag} is marked as prerelease.`);
  }

  return release;
}
