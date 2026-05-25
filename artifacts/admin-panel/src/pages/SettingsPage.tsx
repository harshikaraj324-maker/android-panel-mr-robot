import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { SettingRow, AppIdRow } from "@/lib/api";
import { Settings, Trash2, RefreshCw, Plus, Save, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

export default function SettingsPage() {
  const [appFilter, setAppFilter] = useState("all");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newAppId, setNewAppId] = useState("");
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: settings = [], isLoading, refetch } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.listSettings(),
  });
  const { data: appData } = useQuery({ queryKey: ["app-ids"], queryFn: api.listAppIds });
  const appIds: AppIdRow[] = appData?.rows ?? [];

  const saveMut = useMutation({
    mutationFn: ({ app_id, key, value }: { app_id: string; key: string; value: string }) => api.saveSetting(app_id, key, value),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings"] }); toast({ title: "Setting saved!" }); },
  });

  const addMut = useMutation({
    mutationFn: () => api.saveSetting(newAppId, newKey, newValue),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast({ title: "Setting added!" });
      setNewKey(""); setNewValue(""); setNewAppId("");
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.deleteSetting(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  const allAppIds = Array.from(new Set((settings as SettingRow[]).map((s) => s.app_id)));
  const filtered = appFilter === "all" ? settings as SettingRow[] : (settings as SettingRow[]).filter((s) => s.app_id === appFilter);

  // Group by app_id
  const grouped = filtered.reduce((acc, s) => {
    if (!acc[s.app_id]) acc[s.app_id] = [];
    acc[s.app_id].push(s);
    return acc;
  }, {} as Record<string, SettingRow[]>);

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><Settings className="w-5 h-5 text-primary" /> Settings</h2>
          <p className="text-xs text-muted-foreground mt-0.5">App-wise key-value settings</p>
        </div>
        <div className="flex gap-2">
          <Select value={appFilter} onValueChange={setAppFilter}>
            <SelectTrigger className="w-44 h-8 text-sm"><SelectValue placeholder="All Apps" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Apps</SelectItem>
              {allAppIds.map((id) => <SelectItem key={id} value={id}>{id}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw className="w-3.5 h-3.5" /></Button>
        </div>
      </div>

      {/* Add new setting */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-5">
          <CardTitle className="text-sm font-semibold flex items-center gap-2"><Plus className="w-4 h-4 text-primary" /> New Setting Add Karo</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 px-5 pb-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <Select value={newAppId} onValueChange={setNewAppId}>
              <SelectTrigger className="sm:w-48 text-sm h-8"><SelectValue placeholder="App ID" /></SelectTrigger>
              <SelectContent>
                {appIds.map((a) => <SelectItem key={a.app_id} value={a.app_id}>{a.app_id}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="Key (e.g. max_devices)" value={newKey} onChange={(e) => setNewKey(e.target.value)} className="h-8 text-sm flex-1" />
            <Input placeholder="Value" value={newValue} onChange={(e) => setNewValue(e.target.value)} className="h-8 text-sm flex-1" />
            <Button size="sm" className="h-8"
              onClick={() => addMut.mutate()}
              disabled={!newAppId || !newKey || addMut.isPending}>
              {addMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Plus className="w-3.5 h-3.5 mr-1" /> Add</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Settings by app */}
      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : Object.keys(grouped).length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-14">
            <Settings className="w-10 h-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">Koi setting nahi hai abhi.</p>
            <p className="text-xs text-muted-foreground mt-1">Upar form se add karo.</p>
          </CardContent>
        </Card>
      ) : (
        Object.entries(grouped).map(([appId, rows]) => (
          <Card key={appId}>
            <CardHeader className="pb-2 pt-4 px-5">
              <CardTitle className="text-sm font-semibold font-mono text-primary">{appId}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {rows.map((s) => (
                  <EditableRow key={s.id} setting={s} onSave={(val) => saveMut.mutate({ app_id: s.app_id, key: s.key, value: val })} onDelete={() => deleteMut.mutate(s.id)} />
                ))}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

function EditableRow({ setting, onSave, onDelete }: { setting: SettingRow; onSave: (v: string) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(setting.value);
  return (
    <div className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold font-mono text-foreground">{setting.key}</p>
        {!editing ? (
          <p className="text-xs text-muted-foreground mt-0.5 font-mono">{setting.value}</p>
        ) : (
          <Input value={val} onChange={(e) => setVal(e.target.value)} className="h-7 text-xs mt-1 font-mono"
            onKeyDown={(e) => { if (e.key === "Enter") { onSave(val); setEditing(false); } if (e.key === "Escape") { setVal(setting.value); setEditing(false); } }} autoFocus />
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {!editing ? (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditing(true)}><Save className="w-3 h-3 mr-1" /> Edit</Button>
        ) : (
          <>
            <Button variant="ghost" size="sm" className="h-7 text-xs text-green-600" onClick={() => { onSave(val); setEditing(false); }}>Save</Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setVal(setting.value); setEditing(false); }}>Cancel</Button>
          </>
        )}
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={onDelete}><Trash2 className="w-3.5 h-3.5" /></Button>
      </div>
    </div>
  );
}
