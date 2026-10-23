using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using Newtonsoft.Json.Linq;

public class CPHInline
{
    public bool Execute()
    {
        string rewardId, redemptionId, user;
        CPH.TryGetArg("rewardId", out rewardId);
        CPH.TryGetArg("redemptionId", out redemptionId);
        CPH.TryGetArg("userName", out user);
        Guid parsed;
        if (!Guid.TryParse(rewardId, out parsed) || !Guid.TryParse(redemptionId, out parsed))
        {
            CPH.LogWarn("Dudos Desk: missing redemption IDs; request left pending.");
            return false;
        }
        try
        {
            using (var client = new HttpClient())
            {
                client.Timeout = TimeSpan.FromSeconds(12);
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "__DUDOS_KEY__");
                var body = new JObject {
                    ["category"] = "__DUDOS_CATEGORY__", ["user"] = user ?? "viewer",
                    ["rewardId"] = rewardId, ["redemptionId"] = redemptionId
                };
                var response = client.PostAsync("http://127.0.0.1:__DUDOS_PORT__/api/redeem",
                    new StringContent(body.ToString(), Encoding.UTF8, "application/json")).GetAwaiter().GetResult();
                response.EnsureSuccessStatusCode();
                var result = JObject.Parse(response.Content.ReadAsStringAsync().GetAwaiter().GetResult());
                if ((string)result["decision"] == "accepted" && (bool?)result["ok"] == true)
                    return CPH.TwitchRedemptionFulfill(rewardId, redemptionId);
                if ((string)result["decision"] == "refund" && (bool?)result["ok"] == false)
                {
                    bool ok = CPH.TwitchRedemptionCancel(rewardId, redemptionId);
                    if (ok && (bool?)result["duplicate"] != true)
                    {
                        try { CPH.SendMessage("@" + (user ?? "viewer") + ", Dudos Desk: effect unavailable in the current game mode. Points refunded.", true, true); }
                        catch { CPH.LogWarn("Dudos Desk: refund completed; chat notice failed."); }
                    }
                    return ok;
                }
                CPH.LogWarn("Dudos Desk: request left pending: " + (string)result["reason"]);
                return false;
            }
        }
        catch (Exception)
        {
            // A timeout can follow an accepted effect. Never guess or refund automatically.
            CPH.LogWarn("Dudos Desk: request failed; check pending redemption " + redemptionId);
            return false;
        }
    }
}
