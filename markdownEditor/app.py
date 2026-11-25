import importlib
import os

try:
    psycopg = importlib.import_module("psycopg")
    dict_row = importlib.import_module("psycopg.rows").dict_row
    IntegrityError = psycopg.IntegrityError
except ModuleNotFoundError:
    psycopg = None
    dict_row = None

    class IntegrityError(Exception):
        pass

from flask import (
    Flask,
    flash,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash

app = Flask(__name__)

def get_secret_key():
    secret_key = os.environ.get("SECRET_KEY")
    if secret_key:
        return secret_key

    os.makedirs(app.instance_path, exist_ok=True)
    secret_key_path = os.path.join(app.instance_path, "secret_key")

    try:
        with open(secret_key_path, "x", encoding="ascii") as secret_key_file:
            secret_key_file.write(os.urandom(32).hex())
    except FileExistsError:
        pass

    with open(secret_key_path, "r", encoding="ascii") as secret_key_file:
        secret_key = secret_key_file.read().strip()

    if not secret_key:
        raise RuntimeError("The persisted Flask secret key is empty.")

    return secret_key

app.secret_key = get_secret_key()

def normalize_database_url(url):
    # Render gives postgres:// but psycopg wants postgresql://
    if url and url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    return url

def get_db_connection():
    if psycopg is None:
        raise RuntimeError(
            "The PostgreSQL driver is not installed. Install psycopg[binary]."
        )

    database_url = normalize_database_url(os.environ.get("DATABASE_URL"))

    if not database_url:
        raise RuntimeError("DATABASE_URL environment variable is not set.")

    # Render Postgres needs SSL
    if "sslmode=" not in database_url:
        separator = "&" if "?" in database_url else "?"
        database_url = f"{database_url}{separator}sslmode=require"

    return psycopg.connect(
        database_url,
        row_factory=dict_row
    )

def init_db():
    """Create tables if they don't exist. Prevents 500 on first login/signup."""
    if psycopg is None:
        return
    if not os.environ.get("DATABASE_URL"):
        return
    conn = get_db_connection()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS public.users (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS public.documents (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
                title TEXT NOT NULL DEFAULT 'Untitled',
                content TEXT NOT NULL DEFAULT '',
                updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        conn.commit()
    finally:
        conn.close()

# Run once on startup so Render doesn't 500 when tables are missing
try:
    init_db()
except Exception as e:
    # Don't crash boot, but log it so Render Logs shows it
    print(f"[init_db] failed: {e}", flush=True)

@app.errorhandler(500)
def handle_500(e):
    # Render LogsにTracebackを残す
    import traceback
    traceback.print_exc()
    return "Internal Server Error - check Render Logs", 500

def get_current_user():
    user_id = session.get("user_id")

    if user_id is None:
        return None

    conn = get_db_connection()

    try:
        user = conn.execute(
            """
            SELECT id, name, email
            FROM public.users
            WHERE id = %s
            """,
            (user_id,)
        ).fetchone()
    finally:
        conn.close()

    if user is None:
        session.clear()
        return None

    return user

@app.route("/")
def index():
    if get_current_user() is not None:
        return redirect(url_for("dashboard"))

    return render_template("home.html")

@app.route("/home.html")
def home_page():
    return render_template("home.html")

@app.route("/dashboard")
def dashboard():
    user = get_current_user()

    if user is None:
        return redirect(url_for("login"))

    conn = get_db_connection()

    try:
        documents = conn.execute(
            """
            SELECT id, title, updated_at
            FROM public.documents
            WHERE user_id = %s
            ORDER BY updated_at DESC, id DESC
            """,
            (user["id"],)
        ).fetchall()
    finally:
        conn.close()

    return render_template(
        "dashboard.html",
        current_user=user,
        documents=documents
    )

@app.route("/demo")
def demo():
    return render_template("demo.html")

@app.route("/editor")
def editor():
    user = get_current_user()

    if user is None:
        return redirect(url_for("login"))

    document_id = request.args.get("document_id", type=int)

    conn = get_db_connection()

    try:
        if document_id is not None:
            document = conn.execute(
                """
                SELECT id, title, content
                FROM public.documents
                WHERE id = %s AND user_id = %s
                """,
                (document_id, user["id"])
            ).fetchone()

            if document is None:
                flash("That saved file could not be found.")
                return redirect(url_for("dashboard"))

        elif request.args.get("new"):
            document = None

        else:
            document = conn.execute(
                """
                SELECT id, title, content
                FROM public.documents
                WHERE user_id = %s
                ORDER BY updated_at DESC, id DESC
                LIMIT 1
                """,
                (user["id"],)
            ).fetchone()
    finally:
        conn.close()

    return render_template(
        "index.html",
        current_user=user,
        document=document
    )

@app.route("/documents", methods=["POST"])
def save_document():
    user = get_current_user()

    if user is None:
        return jsonify(
            message="Please log in to save documents."
        ), 401

    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify(
            message="A valid document is required."
        ), 400

    title = data.get("title")
    content = data.get("content")
    document_id = data.get("id")

    if not isinstance(title, str) or not isinstance(content, str):
        return jsonify(
            message="Document title and content must be text."
        ), 400

    title = title.strip() or "Untitled"

    if len(title) > 200:
        return jsonify(
            message="Document title must be 200 characters or fewer."
        ), 400

    conn = get_db_connection()

    try:
        if document_id is None or document_id == "":
            cursor = conn.execute(
                """
                INSERT INTO public.documents
                    (user_id, title, content)
                VALUES (%s, %s, %s)
                RETURNING id
                """,
                (user["id"], title, content)
            )

            document_id = cursor.fetchone()["id"]

        else:
            if (
                isinstance(document_id, bool)
                or not isinstance(document_id, int)
                or document_id < 1
            ):
                return jsonify(
                    message="Document ID is invalid."
                ), 400

            cursor = conn.execute(
                """
                UPDATE public.documents
                SET title = %s,
                    content = %s,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = %s AND user_id = %s
                """,
                (title, content, document_id, user["id"])
            )

            if cursor.rowcount == 0:
                return jsonify(
                    message="Document was not found."
                ), 404

        conn.commit()

    except Exception:
        conn.rollback()
        raise

    finally:
        conn.close()

    return jsonify(
        id=document_id,
        title=title
    ), 200

@app.route("/documents", methods=["GET"])
def list_documents():
    user = get_current_user()

    if user is None:
        return jsonify(
            message="Please log in to view saved documents."
        ), 401

    conn = get_db_connection()

    try:
        documents = conn.execute(
            """
            SELECT id, title, updated_at
            FROM public.documents
            WHERE user_id = %s
            ORDER BY updated_at DESC, id DESC
            """,
            (user["id"],)
        ).fetchall()
    finally:
        conn.close()

    return jsonify(
        documents=[
            {
                "id": document["id"],
                "title": document["title"],
                "updated_at": document["updated_at"].isoformat() if document["updated_at"] else None
            }
            for document in documents
        ]
    )

@app.route("/documents/<int:document_id>", methods=["GET"])
def get_document(document_id):
    user = get_current_user()

    if user is None:
        return jsonify(
            message="Please log in to open saved documents."
        ), 401

    conn = get_db_connection()

    try:
        document = conn.execute(
            """
            SELECT id, title, content
            FROM public.documents
            WHERE id = %s AND user_id = %s
            """,
            (document_id, user["id"])
        ).fetchone()
    finally:
        conn.close()

    if document is None:
        return jsonify(
            message="Document was not found."
        ), 404

    return jsonify(
        id=document["id"],
        title=document["title"],
        content=document["content"]
    )

@app.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return redirect(url_for("index"))

@app.route("/account", methods=["POST"])
def update_account():
    user = get_current_user()

    if user is None:
        return redirect(url_for("login"))

    name = request.form.get("name", "").strip()
    email = request.form.get("email", "").strip()
    current_password = request.form.get("current_password", "")
    new_password = request.form.get("new_password", "")

    if not name or not email:
        flash("Name and email are required.")
        return redirect(url_for("editor"))

    conn = get_db_connection()

    try:
        existing_user = conn.execute(
            """
            SELECT password_hash
            FROM public.users
            WHERE id = %s
            """,
            (session["user_id"],)
        ).fetchone()

        if existing_user is None:
            session.clear()
            return redirect(url_for("login"))

        if new_password:
            if not current_password or not check_password_hash(
                existing_user["password_hash"],
                current_password
            ):
                flash("Enter your current password to change your password.")
                return redirect(url_for("editor"))

            conn.execute(
                """
                UPDATE public.users
                SET name = %s,
                    email = %s,
                    password_hash = %s
                WHERE id = %s
                """,
                (
                    name,
                    email,
                    generate_password_hash(
                        new_password,
                        method="scrypt"
                    ),
                    session["user_id"]
                )
            )

        else:
            conn.execute(
                """
                UPDATE public.users
                SET name = %s,
                    email = %s
                WHERE id = %s
                """,
                (name, email, session["user_id"])
            )

        conn.commit()

    except IntegrityError:
        conn.rollback()
        flash("That email address is already in use.")
        return redirect(url_for("editor"))

    except Exception:
        conn.rollback()
        raise

    finally:
        conn.close()

    flash("Your account has been updated.")
    return redirect(url_for("editor"))

@app.route("/account/delete", methods=["POST"])
def delete_account():
    user = get_current_user()

    if user is None:
        return redirect(url_for("login"))

    password = request.form.get("password", "")

    if not password:
        flash("Enter your password to delete your account.")
        return redirect(url_for("editor"))

    conn = get_db_connection()

    try:
        existing_user = conn.execute(
            """
            SELECT password_hash
            FROM public.users
            WHERE id = %s
            """,
            (session["user_id"],)
        ).fetchone()

        if existing_user is None:
            session.clear()
            return redirect(url_for("login"))

        if not check_password_hash(
            existing_user["password_hash"],
            password
        ):
            flash("Incorrect password. Your account was not deleted.")
            return redirect(url_for("editor"))

        conn.execute(
            """
            DELETE FROM public.users
            WHERE id = %s
            """,
            (session["user_id"],)
        )

        conn.commit()

    except Exception:
        conn.rollback()
        raise

    finally:
        conn.close()

    session.clear()
    flash("Your account has been deleted.")
    return redirect(url_for("index"))

@app.route("/signup", methods=["GET", "POST"])
def signup():
    if request.method == "POST":
        is_json = request.is_json

        data = (
            request.get_json(silent=True)
            if is_json
            else request.form
        )

        if not hasattr(data, "get"):
            if is_json:
                return jsonify(
                    message="Please provide a valid name, email, and password."
                ), 400

            flash("Please provide a valid name, email, and password.")
            return redirect(url_for("signup"))

        name = data.get("name", "")
        email = data.get("email", "")
        password = data.get("password", "")

        if not all(
            isinstance(value, str)
            for value in (name, email, password)
        ):
            if is_json:
                return jsonify(
                    message="Please provide a valid name, email, and password."
                ), 400

            flash("Please provide a valid name, email, and password.")
            return redirect(url_for("signup"))

        name = name.strip()
        email = email.strip().lower()

        if not name or not email or not password:
            if is_json:
                return jsonify(
                    message="Name, email, and password are required."
                ), 400

            flash("Name, email, and password are required.")
            return redirect(url_for("signup"))

        hashed_password = generate_password_hash(
            password,
            method="scrypt"
        )

        conn = get_db_connection()

        try:
            conn.execute(
                """
                INSERT INTO public.users
                    (name, email, password_hash)
                VALUES (%s, %s, %s)
                """,
                (name, email, hashed_password)
            )

            conn.commit()

        except IntegrityError:
            conn.rollback()

            if is_json:
                return jsonify(
                    message="Email already registered."
                ), 409

            flash("Email already registered.")
            return redirect(url_for("signup"))

        except Exception:
            conn.rollback()
            raise

        finally:
            conn.close()

        if is_json:
            return jsonify(
                redirectTo=url_for("login")
            ), 201

        return redirect(url_for("login"))

    return render_template("signup.html")

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        data = (
            request.get_json(silent=True)
            if request.is_json
            else request.form
        )

        email = (
            data.get("email", "")
            if hasattr(data, "get")
            else ""
        ).strip().lower()

        password = (
            data.get("password", "")
            if hasattr(data, "get")
            else ""
        )

        if not email or not password:
            if request.is_json:
                return jsonify(
                    message="Email and password are required."
                ), 400

            flash("Email and password are required.")
            return redirect(url_for("login"))

        conn = get_db_connection()

        try:
            user = conn.execute(
                """
                SELECT id, name, email, password_hash
                FROM public.users
                WHERE email = %s
                """,
                (email,)
            ).fetchone()
        finally:
            conn.close()

        if user and user.get("password_hash") and check_password_hash(
            user["password_hash"],
            password
        ):
            session.clear()
            session["user_id"] = user["id"]

            if request.is_json:
                return jsonify(
                    redirectTo=url_for("dashboard")
                )

            return redirect(url_for("dashboard"))

        if request.is_json:
            return jsonify(
                message="Invalid email or password."
            ), 401

        flash("Invalid email or password.")
        return redirect(url_for("login"))

    return render_template("login.html")

if __name__ == "__main__":
    app.run(
        debug=os.environ.get("FLASK_DEBUG") == "1"
    )
