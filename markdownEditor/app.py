(from flask import Flask, render_template, request

app = Flask(__name__)

@app.route("/", methods=["GET", "POST"])
def home():
    result = ""

    if request.method == "POST":
        name = request.form["name"]
        result = f"Hello, {name}!"

    return render_template("index.html", result=result)

if __name__ == "__main__":
    app.run(debug=True))

print("Hi")

