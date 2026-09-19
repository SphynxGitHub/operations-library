export interface ResourceMatch {
  id: string;
  name: string;
}

// Resources live in workspace_clients.project_data.localResources (each with
// an optional externalUrl — e.g. a Zap's editor link). A Zapier error's
// root_id shows up as a path segment in that same editor URL, so containment
// is a reliable, simple match without needing exact URL parsing.
export async function matchResourceByRootId(supabase: any, clientId: string | null, rootId: string | null): Promise<ResourceMatch | null> {
  if (!clientId || !rootId) return null;

  const { data, error } = await supabase.from("workspace_clients").select("project_data").eq("id", clientId).maybeSingle();
  if (error || !data) return null;

  const resources = data.project_data?.localResources || [];
  const match = resources.find((r: any) => r?.externalUrl && String(r.externalUrl).includes(String(rootId)));
  return match ? { id: match.id, name: match.name } : null;
}
