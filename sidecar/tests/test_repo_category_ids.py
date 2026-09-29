"""追蹤清單的每個 repo 自己帶著它屬於哪些分類。

前端篩選分類時直接用手上的追蹤清單過濾，不必另外查分類成員：以前另查的成員端點預設只回 100 筆，
成員超過 100 個的分類，清單只列得出前 100 個，側欄的數量卻是完整的。
"""
from db.models import Category, Repo, RepoCategory


def _repo(db, n: int) -> Repo:
    repo = Repo(owner="o", name=f"r{n}", full_name=f"o/r{n}", url=f"https://github.com/o/r{n}", github_id=n)
    db.add(repo)
    return repo


def test_every_member_of_a_large_category_carries_it(client, test_db):
    big = Category(name="Big")
    test_db.add(big)
    repos = [_repo(test_db, n) for n in range(1, 121)]
    test_db.flush()
    test_db.add_all([RepoCategory(repo_id=r.id, category_id=big.id) for r in repos])
    test_db.commit()

    listed = client.get("/api/repos").json()["data"]["repos"]

    assert len(listed) == 120
    assert all(r["category_ids"] == [big.id] for r in listed)


def test_lists_every_category_of_a_repo_and_none_for_an_uncategorized_one(client, test_db):
    a, b = Category(name="A"), Category(name="B")
    test_db.add_all([a, b])
    both = _repo(test_db, 1)
    _repo(test_db, 2)  # 不屬於任何分類
    test_db.flush()
    test_db.add_all([RepoCategory(repo_id=both.id, category_id=b.id),
                     RepoCategory(repo_id=both.id, category_id=a.id)])
    test_db.commit()

    by_name = {r["full_name"]: r for r in client.get("/api/repos").json()["data"]["repos"]}

    assert by_name["o/r1"]["category_ids"] == sorted([a.id, b.id])
    assert by_name["o/r2"]["category_ids"] == []


def test_a_single_repo_carries_its_categories_too(client, test_db):
    # 單筆回應也帶：前端拿到的 repo 物件才不會時有時無
    cat = Category(name="A")
    test_db.add(cat)
    repo = _repo(test_db, 1)
    test_db.flush()
    test_db.add(RepoCategory(repo_id=repo.id, category_id=cat.id))
    test_db.commit()

    got = client.get(f"/api/repos/{repo.id}").json()["data"]

    assert got["category_ids"] == [cat.id]
